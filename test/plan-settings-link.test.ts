// nikOS Plan, PR 4 of docs/rfcs/plan-and-spec.md, stage B: nikos.plan.yaml, the snapshot a code repo keeps of
// the settings its maps take from the plan, and nikos settings pull. The plan is a real repo on a local
// bare origin, read through file:// so the partial clone is real. Nothing reaches the network.
import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSettings } from "../src/commands/join";
import { fetchCopy } from "../src/lib/fetch-copy";
import { NewerContractError } from "../src/lib/schema";
import { addArea, initPlanRepo } from "../src/plan/repo";
import { linkProblem, pullPlanSettings, readLink, snapshotHash, writeLink } from "../src/plan/settings-link";
import { bareOrigin } from "./planning-fixture";
import { codeRepo, git, groupRepo, write } from "./repo-fixture";

/** A planning repo: the company's settings at its root, finance's and team WEB's in their folders. Pushed to a bare origin that allows partial clones. */
function planWithSettings(): { plan: string; origin: string } {
  const plan = mkdtempSync(join(tmpdir(), "nikos-plan-src-"));
  git(plan, "init", "-q", "-b", "main");
  initPlanRepo(plan, { name: "Acme", year: "2027" });
  addArea(plan, "department", "finance", { name: "Finance", owner: "Mira" });
  addArea(plan, "team", "WEB", { name: "Checkout web", home: "finance" });
  write(join(plan, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked: [approval.policy]\n");
  write(join(plan, "planning/departments/finance/settings.yaml"), "format_version: 1\ntracker:\n  system: jira\n");
  write(join(plan, "planning/teams/WEB/settings.yaml"), "format_version: 1\ntracker:\n  project: PAY-TEAM\n");
  write(join(plan, "docs/handbook.md"), "# Handbook\n");
  git(plan, "add", "-A");
  git(plan, "commit", "-q", "-m", "plan");
  const origin = bareOrigin();
  git(origin, "config", "uploadpack.allowFilter", "true");
  git(plan, "remote", "add", "origin", origin);
  git(plan, "push", "-q", "origin", "main");
  return { plan, origin: `file://${origin}` };
}

/** A code repo whose one story map is owned by the given key. */
const codeWithMap = (owner: string) => groupRepo(owner, codeRepo());

/** Link a code repo to a plan at url, with an empty snapshot to pull over. */
function linkTo(code: string, url: string) {
  writeLink(code, { format_version: 1, plan: { repo: "acme/company-plan", url }, read: { commit: "0".repeat(40), at: "2026-11-01T00:00:00.000Z" }, company: [], owners: {}, maps: {}, sha256: "" });
}

describe("nikos.plan.yaml and settings pull", () => {
  it("a pull snapshots the company's file and the map owner's chain, read from a sparse clone of the plan", () => {
    const { plan, origin } = planWithSettings();
    const code = codeWithMap("WEB");
    linkTo(code, origin);
    const r = pullPlanSettings(code);
    expect(r.warnings).toEqual([]);
    expect(r.link.read.commit).toBe(git(plan, "rev-parse", "HEAD"));
    expect(r.link.company).toEqual([{ rel: "company", data: { format_version: 1, approval: { policy: "required-for-release" }, locked: ["approval.policy"] } }]);
    expect(r.link.owners).toEqual({
      WEB: {
        levels: [
          { rel: "departments/finance", data: { format_version: 1, tracker: { system: "jira" } } },
          { rel: "teams/WEB", data: { format_version: 1, tracker: { project: "PAY-TEAM" } } },
        ],
      },
    });
    // What's on disk is what the pull returned, and it's the file a hand edit is checked against.
    expect(readLink(code)).toEqual(r.link);
    expect(linkProblem(code)).toBeUndefined();
    expect(readFileSync(join(code, "nikos.plan.yaml"), "utf8")).toMatch(/^# nikOS: this repo's link/);
  });

  it("a sparse fetch of the plan keeps its root settings file (cone mode) and leaves other folders out", () => {
    const { origin } = planWithSettings();
    const dir = mkdtempSync(join(tmpdir(), "nikos-sparse-"));
    const got = fetchCopy(origin, undefined, join(dir, "copy"), ["planning"]);
    expect("commit" in got).toBe(true);
    const copy = join(dir, "copy");
    expect(existsSync(join(copy, "nikos.settings.yaml"))).toBe(true);
    expect(existsSync(join(copy, "planning/teams/WEB/settings.yaml"))).toBe(true);
    expect(existsSync(join(copy, "docs"))).toBe(false);
  });

  it("a hand edit to the snapshot is caught by linkProblem, and a pull puts it right", () => {
    const { origin } = planWithSettings();
    const code = codeWithMap("WEB");
    linkTo(code, origin);
    pullPlanSettings(code);
    writeFileSync(join(code, "nikos.plan.yaml"), readFileSync(join(code, "nikos.plan.yaml"), "utf8").replace("PAY-TEAM", "HAND"));
    expect(linkProblem(code)).toContain("edited by hand: run nikos settings pull");
    pullPlanSettings(code);
    expect(linkProblem(code)).toBeUndefined();
  });

  it("a settings file that doesn't read refuses the pull, names the file, and keeps the last snapshot", () => {
    const { plan, origin } = planWithSettings();
    const code = codeWithMap("WEB");
    linkTo(code, origin);
    pullPlanSettings(code);
    const before = readFileSync(join(code, "nikos.plan.yaml"), "utf8");
    write(join(plan, "planning/teams/WEB/settings.yaml"), "tracker: [broken\n");
    git(plan, "commit", "-qam", "break the team's settings");
    git(plan, "push", "-q", "origin", "main");
    expect(() => pullPlanSettings(code)).toThrow("planning/teams/WEB/settings.yaml doesn't read");
    expect(() => pullPlanSettings(code)).toThrow("Nothing was pulled, and the last snapshot is kept.");
    expect(readFileSync(join(code, "nikos.plan.yaml"), "utf8")).toBe(before);
  });

  it("an owner with no team in the plan gets the company's settings only, and the pull says so", () => {
    const { origin } = planWithSettings();
    const code = codeWithMap("NOPE");
    linkTo(code, origin);
    const r = pullPlanSettings(code);
    expect(r.link.owners).toEqual({});
    expect(r.link.company).toHaveLength(1);
    expect(r.warnings).toEqual(["NOPE has no team area in the plan, so its maps take the company's settings only"]);
  });

  it("an unreachable plan writes nothing, and keeps the last snapshot", () => {
    const { origin } = planWithSettings();
    const code = codeWithMap("WEB");
    linkTo(code, origin);
    pullPlanSettings(code);
    const before = readFileSync(join(code, "nikos.plan.yaml"), "utf8");
    const link = readLink(code)!;
    writeLink(code, { ...link, plan: { repo: "acme/company-plan", url: join(tmpdir(), "no-such-plan-nikos-pull") } });
    const broken = readFileSync(join(code, "nikos.plan.yaml"), "utf8");
    expect(() => pullPlanSettings(code)).toThrow(/^Couldn't read acme\/company-plan: .+ The last snapshot is kept\.$/);
    expect(readFileSync(join(code, "nikos.plan.yaml"), "utf8")).toBe(broken);
    expect(broken).not.toBe(before);
  });

  it("a link written by a newer nikOS is refused, and a link that doesn't read says why", () => {
    const code = codeWithMap("WEB");
    write(join(code, "nikos.plan.yaml"), "format_version: 2\n");
    expect(() => readLink(code)).toThrow(NewerContractError);
    write(join(code, "nikos.plan.yaml"), "format_version: 1\nplan: {repo: acme/company-plan}\n");
    expect(() => readLink(code)).toThrow("nikos.plan.yaml doesn't read");
    expect(() => pullPlanSettings(codeWithMap("WEB"))).toThrow("This repo isn't linked to a planning repo");
  });

  it("the hash doesn't depend on key order, and runSettings pull prints what it pulled", () => {
    const a = { company: [{ rel: "company", data: { a: 1, b: { x: 1, y: 2 } } }], owners: {} };
    const b = { owners: {}, company: [{ rel: "company", data: { b: { y: 2, x: 1 }, a: 1 } }] };
    expect(snapshotHash(a)).toBe(snapshotHash(b));

    const { origin } = planWithSettings();
    const code = codeWithMap("WEB");
    linkTo(code, origin);
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...x) => void out.push(x.join(" ")));
    try {
      expect(runSettings(["pull", "--dir", code])).toBe(0);
    } finally {
      log.mockRestore();
    }
    expect(out[0]).toMatch(/^✓ Pulled the settings from acme\/company-plan at [0-9a-f]{7} for WEB\.$/);
  });
});
