// nikos plan refresh: each code repo listed in planning/repos.yaml is read read-only, its maps' storymap and
// delivery copies kept under .nikos/delivery/, and a failed read keeps the last good copy. Real local git
// repos, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { initPlanRepo } from "../src/plan/repo";
import { refreshDelivery } from "../src/plan/refresh";
import { runPlanRepo } from "../src/plan/cli";
import { groupRepo, git, write, commitAll } from "./repo-fixture";

const DELIVERY = (plan: string, host: string, repo: string) => join(plan, ".nikos", "delivery", host, ...repo.split("/"));
const index = (plan: string) => JSON.parse(readFileSync(join(plan, ".nikos", "delivery", "index.json"), "utf8")).repos;

/** A planning repo listing the given repos (each with a local url), in the new layout. */
function planWith(listed: { repo: string; url: string; ref?: string }[], version = 1): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-refresh-plan-"));
  initPlanRepo(dir, { name: "Acme", year: "2027" });
  const entries = listed.map((e) => `  - repo: ${e.repo}\n    url: "${e.url}"${e.ref ? `\n    ref: ${e.ref}` : ""}\n`).join("");
  write(join(dir, "planning/repos.yaml"), `version: ${version}\nrepos:${entries ? `\n${entries}` : " []\n"}`);
  return dir;
}

/** A code repo with one map (PAY-CHK-*), committed on main, as groupRepo makes it. */
const codeRepoWithMap = () => groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-refresh-code-")));

const NOW = "2026-11-09T12:00:00.000Z";

describe("nikos plan refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => vi.useRealTimers());

  it("reads a listed repo and keeps only the storymap and delivery copies of each map", () => {
    const code = codeRepoWithMap();
    const plan = planWith([{ repo: "acme/payments-web", url: code }]);
    const report = refreshDelivery(plan);

    const copy = DELIVERY(plan, "github.com", "acme/payments-web");
    expect(existsSync(join(copy, "maps/chk/storymap.yaml"))).toBe(true);
    expect(existsSync(join(copy, "maps/chk/delivery.yaml"))).toBe(true);
    // Only what Plan reads: nothing outside maps/, and no feature files inside a map.
    expect(existsSync(join(copy, "planning"))).toBe(false);
    expect(existsSync(join(copy, "maps/chk/features"))).toBe(false);
    expect(existsSync(join(copy, ".git"))).toBe(false);
    expect(readFileSync(join(copy, "maps/chk/storymap.yaml"), "utf8")).toBe(readFileSync(join(code, "maps/chk/storymap.yaml"), "utf8"));

    const head = git(code, "rev-parse", "HEAD");
    expect(index(plan)["github.com/acme/payments-web"]).toMatchObject({ repo: "acme/payments-web", host: "github.com", ref: "default", state: "ok", commit: head, read_at: NOW, maps: ["chk"] });
    expect(report.repos).toEqual([{ repo: "acme/payments-web", host: "github.com", state: "ok", commit: head, read_at: NOW, kept: false, maps: 1 }]);
    // The read leaves no scratch folder behind.
    expect(existsSync(join(plan, ".nikos", "delivery", ".fetch"))).toBe(false);
  });

  it("reads the default branch when no ref is named, even when it isn't main", () => {
    const code = codeRepoWithMap();
    git(code, "branch", "-m", "main", "trunk");
    const plan = planWith([{ repo: "acme/payments-web", url: code }]);
    refreshDelivery(plan);
    expect(index(plan)["github.com/acme/payments-web"]).toMatchObject({ state: "ok", ref: "default", commit: git(code, "rev-parse", "HEAD") });
    expect(existsSync(join(DELIVERY(plan, "github.com", "acme/payments-web"), "maps/chk/storymap.yaml"))).toBe(true);
  });

  it("keeps the last good copy when a later read fails, and says why", () => {
    const code = codeRepoWithMap();
    const plan = planWith([{ repo: "acme/payments-web", url: code }]);
    refreshDelivery(plan);

    // The code repo moves away, so the next read can't find it.
    const moved = `${code}-moved`;
    renameSync(code, moved);
    vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
    try {
      const report = refreshDelivery(plan);
      const entry = index(plan)["github.com/acme/payments-web"];
      expect(entry).toMatchObject({ state: "unreachable", read_at: NOW, attempted_at: "2026-11-12T12:00:00.000Z", maps: ["chk"] });
      expect(entry.reason).toEqual(expect.any(String));
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(existsSync(join(DELIVERY(plan, "github.com", "acme/payments-web"), "maps/chk/storymap.yaml"))).toBe(true);
      expect(report.repos[0]).toMatchObject({ state: "unreachable", kept: true, read_at: NOW });
    } finally {
      renameSync(moved, code);
    }
  });

  it("records a repo that can't be read, with no copy, when it has never been read", () => {
    const plan = planWith([{ repo: "acme/nowhere", url: join(tmpdir(), "nikos-no-such-repo-xyz") }]);
    const report = refreshDelivery(plan);
    expect(index(plan)["github.com/acme/nowhere"]).toMatchObject({ state: "unreachable", maps: [], attempted_at: NOW });
    expect(index(plan)["github.com/acme/nowhere"].read_at).toBeUndefined();
    expect(existsSync(DELIVERY(plan, "github.com", "acme/nowhere"))).toBe(false);
    expect(report.repos[0]).toMatchObject({ state: "unreachable", kept: false });
  });

  it("reads only the repos listed in repos.yaml", () => {
    const listed = codeRepoWithMap();
    codeRepoWithMap(); // a second repo with maps, that the plan doesn't list
    const plan = planWith([{ repo: "acme/payments-web", url: listed }]);
    refreshDelivery(plan);
    expect(Object.keys(index(plan))).toEqual(["github.com/acme/payments-web"]);
    expect(existsSync(DELIVERY(plan, "github.com", "acme/other-web"))).toBe(false);
  });

  it("drops the copy of a repo that is no longer listed", () => {
    const code = codeRepoWithMap();
    const plan = planWith([{ repo: "acme/payments-web", url: code }]);
    refreshDelivery(plan);
    expect(existsSync(DELIVERY(plan, "github.com", "acme/payments-web"))).toBe(true);
    write(join(plan, "planning/repos.yaml"), "version: 1\nrepos: []\n");
    refreshDelivery(plan);
    expect(index(plan)).toEqual({});
    expect(existsSync(DELIVERY(plan, "github.com", "acme/payments-web"))).toBe(false);
  });

  it("refuses a newer repos.yaml before any repo is fetched", () => {
    const code = codeRepoWithMap();
    const plan = planWith([{ repo: "acme/payments-web", url: code }], 2);
    expect(() => refreshDelivery(plan)).toThrow(/newer nikOS: upgrade nikos in the planning repo/);
    expect(existsSync(join(plan, ".nikos", "delivery", ".fetch"))).toBe(false);
    expect(existsSync(join(plan, ".nikos", "delivery", "index.json"))).toBe(false);
  });

  it("copies a delivery.yaml from a newer nikOS as it is: Plan's reader refuses it, not refresh", () => {
    const code = codeRepoWithMap();
    write(join(code, "maps/chk/delivery.yaml"), "version: 2\nmap: chk\nread_at: 2026-11-09T12:00:00.000Z\nstories: []\n");
    commitAll(code, "newer delivery");
    const plan = planWith([{ repo: "acme/payments-web", url: code }]);
    refreshDelivery(plan);
    expect(readFileSync(join(DELIVERY(plan, "github.com", "acme/payments-web"), "maps/chk/delivery.yaml"), "utf8")).toContain("version: 2");
    expect(index(plan)["github.com/acme/payments-web"].state).toBe("ok");
  });

  it("keeps .nikos/ ignored, and leaves a tracked file of the planning repo alone", () => {
    const code = codeRepoWithMap();
    const plan = planWith([{ repo: "acme/payments-web", url: code }]);
    // A planning repo with no .gitignore of its own: refresh must not add one (that would dirty it).
    rmSync(join(plan, ".gitignore"));
    git(plan, "init", "-q", "-b", "main");
    commitAll(plan, "plan");
    refreshDelivery(plan);
    expect(spawnSync("git", ["check-ignore", "-q", ".nikos/delivery/index.json"], { cwd: plan }).status).toBe(0);
    expect(git(plan, "status", "--porcelain")).toBe("");
  });

  it("lists .nikos/ in the .gitignore that plan init writes", () => {
    const plan = planWith([]);
    expect(readFileSync(join(plan, ".gitignore"), "utf8")).toContain(".nikos/");
    refreshDelivery(plan);
    expect(readFileSync(join(plan, ".gitignore"), "utf8").match(/^\.nikos\/$/gm)).toHaveLength(1);
  });

  it("prints one line per repo, with the commit it read, or why it couldn't", async () => {
    const code = codeRepoWithMap();
    const plan = planWith([{ repo: "acme/payments-web", url: code }, { repo: "acme/nowhere", url: join(tmpdir(), "nikos-no-such-repo-xyz") }]);
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    try {
      expect(await runPlanRepo(["refresh", "--dir", plan])).toBe(0);
    } finally {
      log.mockRestore();
    }
    const head = git(code, "rev-parse", "--short=7", "HEAD");
    expect(out).toEqual([
      `✓ acme/payments-web: read today (2026-11-09) at ${head}`,
      expect.stringContaining("! acme/nowhere: unreachable ("),
    ]);
    expect(out[1]).toContain("no copy yet");
  });
});
