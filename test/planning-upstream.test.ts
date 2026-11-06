import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { checkStale, crossRefs, loadUpstream, resolveRef, sync } from "../src/planning/upstream";
import { newKr } from "../src/planning/krs";
import { runPlanning } from "../src/planning/cli";
import { copyExample } from "./helpers";

// A company plan in its own git repo, and a team repo that plans against it.
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
function companyPlan(): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-company-"));
  git(dir, "init", "-q", "-b", "main");
  newKr({ id: "kr-2", title: "Plants alive after 90 days", owner: "Company", baseline: 62, target: 80, by: "2027-03-31", unit: "%" }, dir);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "plan");
  return dir;
}
function team(upstream: { repo: string; url: string }[]): string {
  const root = dirname(copyExample());
  git(root, "init", "-q", "-b", "main");
  mkdirSync(join(root, "planning"), { recursive: true });
  writeFileSync(join(root, "planning/upstream.yaml"), upstream.map((u) => `- repo: ${u.repo}\n  ref: main\n  url: ${u.url}\n`).join(""));
  newKr({ id: "acted-on", title: "Reminders acted on", owner: "Team", baseline: 41, target: 60, by: "2027-03-31", alignsTo: "acme/company-plan#kr-2" }, root);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "team");
  return root;
}

describe("upstream", () => {
  it("syncs and locks the commit", () => {
    const company = companyPlan();
    const root = team([{ repo: "acme/company-plan", url: company }]);
    const r = sync(root);
    expect(r.unresolved).toEqual([]);
    const head = git(company, "rev-parse", "HEAD");
    const lock = parse(readFileSync(join(root, "planning/upstream.lock"), "utf8"));
    expect(lock).toEqual([expect.objectContaining({ repo: "acme/company-plan", ref: "main", commit: head })]);
    expect(existsSync(join(root, ".nikos/upstream/acme/company-plan/planning/krs/kr-2.yaml"))).toBe(true);
    expect(existsSync(join(root, ".nikos/upstream/acme/company-plan/.git"))).toBe(false);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toMatch(/^\.nikos\/$/m);
    expect(resolveRef(root, "acme/company-plan#kr-2")?.data.title).toBe("Plants alive after 90 days");
    expect(loadUpstream(root)[0]).toMatchObject({ repo: "acme/company-plan", commit: head });
  });

  it("an unreachable repo is unresolved and planning carries on", async () => {
    const company = companyPlan();
    const root = team([
      { repo: "acme/company-plan", url: company },
      { repo: "acme/secret-plan", url: join(tmpdir(), "no-such-repo-nikos") },
    ]);
    const r = sync(root);
    expect(r.unresolved.map((u) => u.repo)).toEqual(["acme/secret-plan"]);
    expect(r.synced.map((s) => s.repo)).toEqual(["acme/company-plan"]);
    newKr({ id: "other", title: "Other", owner: "Team", baseline: 0, target: 1, by: "2027-03-31", alignsTo: "acme/secret-plan#kr-9" }, root);
    expect(crossRefs(root)).toEqual(
      expect.arrayContaining([
        { ref: "acme/company-plan#kr-2", file: "planning/krs/acted-on.yaml", resolved: true },
        { ref: "acme/secret-plan#kr-9", file: "planning/krs/other.yaml", resolved: false },
      ]),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runPlanning(["validate", "--dir", root]);
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    log.mockRestore();
    expect(out).toContain("? planning/krs/other.yaml: acme/secret-plan#kr-9 is unresolved");
    expect(code).toBe(0);
  });

  it("check flags a moved upstream as stale", () => {
    const company = companyPlan();
    const root = team([{ repo: "acme/company-plan", url: company }]);
    sync(root);
    expect(checkStale(root).stale).toEqual([]);
    writeFileSync(join(company, "planning/krs/kr-2.yaml"), readFileSync(join(company, "planning/krs/kr-2.yaml"), "utf8").replace("target: 80", "target: 85"));
    git(company, "commit", "-q", "-am", "raise target");
    const stale = checkStale(root).stale;
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ repo: "acme/company-plan", current: git(company, "rev-parse", "HEAD") });
  });

  it("only references are committed", () => {
    const company = companyPlan();
    const root = team([{ repo: "acme/company-plan", url: company }]);
    sync(root);
    const changed = git(root, "status", "--porcelain", "--untracked-files=all").split("\n").map((l) => l.slice(3)).sort();
    expect(changed).toEqual([".gitignore", "planning/upstream.lock"]);
    expect(git(root, "check-ignore", ".nikos/upstream/acme/company-plan/planning/krs/kr-2.yaml")).toBeTruthy();
    const tracked = git(root, "ls-files").split("\n");
    for (const f of tracked.filter((f) => f.startsWith("planning/"))) expect(readFileSync(join(root, f), "utf8")).not.toContain("Plants alive after 90 days");
    expect(readFileSync(join(root, "planning/krs/acted-on.yaml"), "utf8")).toContain("aligns_to: acme/company-plan#kr-2");
  });
});
