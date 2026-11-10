// nikOS Plan, PR 4 of docs/rfcs/plan-and-spec.md, stage E: doctor and validate check a code repo's plan snapshot.
// doctor warns on a stale snapshot, a map whose owner has no chain, a value of its own that a lock ignores,
// and (online only) a plan that moved on. validate fails a hand-edited snapshot, offline. The plan is a real
// repo on a local bare origin, read through file://. Nothing reaches the network.
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor } from "../src/commands/doctor";
import { validate, validateGroup } from "../src/commands/validate";
import { addArea, initPlanRepo } from "../src/plan/repo";
import { pullPlanSettings, readLink, writeLink, type PlanLink } from "../src/plan/settings-link";
import { bareOrigin } from "./planning-fixture";
import { codeRepo, git, groupRepo, write } from "./repo-fixture";

const DAY = 24 * 60 * 60 * 1000;

/** A plan with the company locking the approval policy, and team WEB's chain below it. Pushed to a bare origin. */
function planWithSettings(): { plan: string; origin: string } {
  const plan = mkdtempSync(join(tmpdir(), "nikos-check-plan-"));
  git(plan, "init", "-q", "-b", "main");
  initPlanRepo(plan, { name: "Acme", year: "2027" });
  addArea(plan, "department", "finance", { name: "Finance", owner: "Mira" });
  addArea(plan, "team", "WEB", { name: "Checkout web", home: "finance" });
  write(join(plan, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked: [approval.policy]\n");
  write(join(plan, "planning/teams/WEB/settings.yaml"), "format_version: 1\ntracker:\n  project: PAY-TEAM\n");
  git(plan, "add", "-A");
  git(plan, "commit", "-q", "-m", "plan");
  const origin = bareOrigin();
  git(origin, "config", "uploadpack.allowFilter", "true");
  git(plan, "remote", "add", "origin", origin);
  git(plan, "push", "-q", "origin", "main");
  return { plan, origin: `file://${origin}` };
}

/** A code repo linked to the plan at url, its snapshot pulled from the plan. */
function linkedCode(url: string, owner = "WEB"): string {
  const code = groupRepo(owner, codeRepo());
  writeLink(code, { format_version: 1, plan: { repo: "acme/company-plan", url }, read: { commit: "0".repeat(40), at: new Date().toISOString() }, company: [], owners: {}, maps: {}, sha256: "" });
  pullPlanSettings(code);
  return code;
}

const find = (checks: ReturnType<typeof doctor>, name: string) => checks.find((c) => c.name === name);

describe("validate and the plan snapshot", () => {
  it("a hand-edited snapshot is an error that says to run nikos settings pull, and a pull clears it", () => {
    const { origin } = planWithSettings();
    const code = linkedCode(origin);
    expect(validate(code).errors.filter((e) => e.file === "nikos.plan.yaml")).toEqual([]);
    const path = join(code, "nikos.plan.yaml");
    writeFileSync(path, readFileSync(path, "utf8").replace("PAY-TEAM", "HAND"));
    const bad = validate(code).errors.filter((e) => e.file === "nikos.plan.yaml");
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain("edited by hand: run nikos settings pull");
    expect(validateGroup(code).errors.filter((e) => e.file === "nikos.plan.yaml")).toHaveLength(1);
    pullPlanSettings(code);
    expect(validate(code).errors.filter((e) => e.file === "nikos.plan.yaml")).toEqual([]);
  });

  it("validate never reads the plan: an unreachable plan still passes the snapshot check", () => {
    const { origin } = planWithSettings();
    const code = linkedCode(origin);
    const link = readLink(code)!;
    writeLink(code, { ...link, plan: { ...link.plan, url: `file://${join(mkdtempSync(join(tmpdir(), "nikos-gone-")), "nowhere.git")}` } });
    expect(validate(code).errors.filter((e) => e.file === "nikos.plan.yaml")).toEqual([]);
  });
});

describe("doctor and the plan snapshot", () => {
  it("a snapshot older than 14 days is stale, and --offline skips the plan check", () => {
    const { origin } = planWithSettings();
    const code = linkedCode(origin);
    const link = readLink(code)!;
    writeLink(code, { ...link, read: { ...link.read, at: new Date(Date.now() - 30 * DAY).toISOString() } });
    const checks = doctor(code, { offline: true });
    expect(find(checks, "plan settings")).toMatchObject({ status: "warn", next: "Run nikos settings pull to refresh them from the plan" });
    expect(find(checks, "plan current")).toBeUndefined();
  });

  it("a plan that moved on since the snapshot is a warning, and one that can't be reached is too", () => {
    const { plan, origin } = planWithSettings();
    const code = linkedCode(origin);
    expect(find(doctor(code), "plan current")).toMatchObject({ status: "ok" });
    write(join(plan, "planning/teams/WEB/settings.yaml"), "format_version: 1\ntracker:\n  project: NEW\n");
    git(plan, "commit", "-qam", "change WEB");
    git(plan, "push", "-q", "origin", "main");
    expect(find(doctor(code), "plan current")).toMatchObject({ status: "warn", found: expect.stringContaining("has moved on since the snapshot") });
    expect(find(doctor(code, { offline: true }), "plan current")).toBeUndefined();

    const gone = linkedCode(origin);
    const link = readLink(gone)!;
    writeLink(gone, { ...link, plan: { ...link.plan, url: `file://${join(mkdtempSync(join(tmpdir(), "nikos-gone-")), "nowhere.git")}` } });
    expect(find(doctor(gone), "plan current")).toMatchObject({ status: "warn", found: expect.stringContaining("couldn't reach acme/company-plan") });
  });

  it("a map with no owner, or an owner with no team in the plan, warns that it takes the company's settings only", () => {
    const { origin } = planWithSettings();
    const unknown = linkedCode(origin, "NOPE");
    expect(find(doctor(unknown, { offline: true }), "map owners")).toMatchObject({ status: "warn", found: expect.stringContaining("NOPE (maps/chk) has no team in acme/company-plan") });
    const none = linkedCode(origin);
    write(join(none, "maps/chk/storymap.yaml"), readFileSync(join(none, "maps/chk/storymap.yaml"), "utf8").replace("owner: WEB\n", ""));
    expect(find(doctor(none, { offline: true }), "map owners")).toMatchObject({ status: "warn", found: expect.stringContaining("maps/chk has no owner") });
  });

  it("a value of this repo's own that a level above locks is reported as ignored", () => {
    const { origin } = planWithSettings();
    const code = linkedCode(origin);
    expect(find(doctor(code, { offline: true }), "own settings")).toMatchObject({ status: "ok", found: "none ignored" });
    write(join(code, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: off\n");
    expect(find(doctor(code, { offline: true }), "own settings")).toMatchObject({
      status: "warn",
      found: "approval.policy from this repo is ignored: acme/company-plan company locks it",
    });
  });

  it("a repo with no link has no plan checks", () => {
    const names = doctor(groupRepo("WEB", codeRepo()), { offline: true }).map((c) => c.name);
    expect(names).not.toContain("plan settings");
    expect(names).not.toContain("own settings");
  });
});

