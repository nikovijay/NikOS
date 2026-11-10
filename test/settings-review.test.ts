// nikOS Plan, the review fixes to settings inheritance (rule 6 of docs/rfcs/plan-and-spec.md). A code repo's maps can
// have different owners, so each map's chain is checked on its own; a link is made from main; a checkout is read only
// at the branch the join means; and a link that isn't committed, or that lives only on nikos/link, is said so.
// Local bare repos stand in for the forge. Nothing reaches the network.
import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { joinPlanRepo } from "../src/commands/join";
import { runSettings } from "../src/commands/join";
import { doctor } from "../src/commands/doctor";
import { validateGroup, validate } from "../src/commands/validate";
import { resolveSettings, setSetting } from "../src/lib/settings";
import { addArea, initPlanRepo } from "../src/plan/repo";
import { pullPlanSettings, writeLink } from "../src/plan/settings-link";
import { bareOrigin } from "./planning-fixture";
import { codeRepo, git, groupRepo, write } from "./repo-fixture";

/** A plan on a bare origin: the company locks the approval policy; team WEB sets a project; team PAY locks its own. */
function planOnOrigin(): string {
  const plan = mkdtempSync(join(tmpdir(), "nikos-review-plan-"));
  git(plan, "init", "-q", "-b", "main");
  initPlanRepo(plan, { name: "Acme", year: "2027" });
  addArea(plan, "department", "finance", { name: "Finance", owner: "Mira" });
  addArea(plan, "team", "WEB", { name: "Checkout web", home: "finance" });
  addArea(plan, "team", "PAY", { name: "Payments", home: "finance" });
  write(join(plan, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked: [approval.policy]\n");
  write(join(plan, "planning/teams/WEB/settings.yaml"), "format_version: 1\ntracker:\n  project: WEB-TEAM\n");
  write(join(plan, "planning/teams/PAY/settings.yaml"), "format_version: 1\ntracker:\n  project: PAY-TEAM\nlocked: [tracker.project]\n");
  git(plan, "add", "-A");
  git(plan, "commit", "-q", "-m", "plan");
  const origin = bareOrigin();
  git(origin, "config", "uploadpack.allowFilter", "true");
  git(plan, "remote", "add", "origin", origin);
  git(plan, "push", "-q", "origin", "main");
  return origin;
}

/**
 * A checkout of the plan on origin, as a person has it. Joins here read it with --plan-dir, so no temp clone is made
 * (the plan-join tests count those, and they run alongside this file).
 */
function checkoutOf(origin: string): string {
  const parent = mkdtempSync(join(tmpdir(), "nikos-review-co-"));
  git(parent, "clone", "-q", origin, "checkout");
  return join(parent, "checkout");
}

/** A code repo with two story maps, chk (owned by WEB) and pay (owned by PAY), linked to the plan with its snapshot pulled. */
function twoMapRepo(origin: string): string {
  const code = groupRepo("WEB", codeRepo());
  write(join(code, "maps/pay/storymap.yaml"), "format_version: 1\nproject: pay\nkey: PAY\nowner: PAY\nactivities: []\nreleases: []\n");
  git(code, "add", "-A");
  git(code, "commit", "-q", "-m", "second map");
  writeLink(code, { format_version: 1, plan: { repo: "acme/company-plan", url: origin }, read: { commit: "0".repeat(40), at: new Date().toISOString() }, company: [], owners: {}, maps: {}, sha256: "" });
  pullPlanSettings(code);
  return code;
}

/** A code repo with one map owned by WEB, joined to the plan (so its link is committed on nikos/link), left on main. */
function joinedOnNikosLink(origin: string): string {
  const code = groupRepo("WEB", codeRepo());
  joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkoutOf(origin) });
  git(code, "switch", "-q", "main");
  return code;
}

describe("settings with maps that have different owners", () => {
  it("an owner changed in a storymap fails validate until the snapshot is pulled, and the map keeps the owner it was bound to", () => {
    const code = twoMapRepo(planOnOrigin());
    expect(validateGroup(code).errors.filter((e) => e.file === "nikos.plan.yaml")).toEqual([]);
    const chk = join(code, "maps/chk");
    write(join(chk, "storymap.yaml"), readFileSync(join(chk, "storymap.yaml"), "utf8").replace("owner: WEB", "owner: PAY"));
    const bad = validateGroup(code).errors.filter((e) => e.file === "nikos.plan.yaml");
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain("maps/chk's owner is PAY, but nikos.plan.yaml takes its settings from WEB");
    expect(bad[0].message).toContain("run nikos settings pull");
    // Until the pull, the map still takes WEB's settings: a typo in an owner can't drop a team's locks.
    expect(resolveSettings(code, { map: chk })["tracker.project"]).toEqual({ value: "WEB-TEAM", from: "acme/company-plan teams/WEB" });
    pullPlanSettings(code);
    expect(validateGroup(code).errors.filter((e) => e.file === "nikos.plan.yaml")).toEqual([]);
    expect(resolveSettings(code, { map: chk })["tracker.project"].value).toBe("PAY-TEAM");
  });

  it("a map the snapshot doesn't know yet fails validate, and a pull adds it", () => {
    const code = twoMapRepo(planOnOrigin());
    write(join(code, "maps/new/storymap.yaml"), "format_version: 1\nproject: new\nkey: NEW\nowner: WEB\nactivities: []\nreleases: []\n");
    expect(validateGroup(code).errors.some((e) => e.message.includes("maps/new isn't in nikos.plan.yaml yet"))).toBe(true);
    pullPlanSettings(code);
    expect(validateGroup(code).errors.filter((e) => e.file === "nikos.plan.yaml")).toEqual([]);
  });

  it("a team's lock on one map holds: settings set refuses the value even though another map's owner doesn't lock it", () => {
    const code = twoMapRepo(planOnOrigin());
    expect(resolveSettings(code)["tracker.project"].value).toBe("");
    expect(() => setSetting(code, "tracker.project", "HACKED")).toThrow("tracker.project is locked by acme/company-plan teams/PAY (for maps/pay), so it can't be changed here");
    expect(existsSync(join(code, "nikos.settings.yaml"))).toBe(false);
  });

  it("settings show --map shows the settings one story map takes", () => {
    const code = twoMapRepo(planOnOrigin());
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(runSettings(["show", "--map", "pay", "--dir", code])).toBe(0);
      expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/^map: pay\n[\s\S]*tracker\.project: "PAY-TEAM"/);
      log.mockClear();
      expect(runSettings(["show", "--map", "chk", "--dir", code])).toBe(0);
      expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain('tracker.project: "WEB-TEAM"');
    } finally {
      log.mockRestore();
    }
  });
});

describe("join makes the link from main, and reads a checkout only at the branch it means", () => {
  it("the link is made from main, so an unpushed feature branch's commits stay out of it", () => {
    const origin = planOnOrigin();
    const code = codeRepo();
    git(code, "switch", "-q", "-c", "feature");
    write(join(code, "unfinished.md"), "work in progress\n");
    git(code, "add", "-A");
    git(code, "commit", "-q", "-m", "unfinished feature work");
    const r = joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkoutOf(origin) });
    expect(r.link?.written).toBe(true);
    expect(git(code, "branch", "--show-current")).toBe("nikos/link");
    expect(git(code, "log", "--format=%s", "nikos/link")).not.toContain("unfinished feature work");
    expect(git(code, "show", "--name-only", "--format=", "nikos/link")).toBe("nikos.plan.yaml");
    expect(git(code, "rev-parse", "feature")).toBeTruthy();
    expect(git(code, "log", "--format=%s", "feature")).toContain("unfinished feature work");
  });

  it("a checkout of the plan on a branch that changes its settings is refused, and nothing is written", () => {
    const origin = planOnOrigin();
    const parent = mkdtempSync(join(tmpdir(), "nikos-review-co-"));
    git(parent, "clone", "-q", origin, "checkout");
    const checkout = join(parent, "checkout");
    git(checkout, "switch", "-q", "-c", "feature");
    write(join(checkout, "planning/teams/WEB/settings.yaml"), "format_version: 1\ntracker:\n  project: FEATURE-ONLY\n");
    git(checkout, "commit", "-qam", "feature change to WEB");
    const code = codeRepo();
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkout })).toThrow("its planning/ settings differ from main");
    expect(git(code, "branch", "--show-current")).toBe("main");
    expect(existsSync(join(code, "nikos.plan.yaml"))).toBe(false);
  });

  it("a link written but never committed stops the next join, and names the commit to make", () => {
    const origin = planOnOrigin();
    const code = codeRepo();
    writeLink(code, { format_version: 1, plan: { repo: "acme/company-plan", url: origin }, read: { commit: "0".repeat(40), at: new Date().toISOString() }, company: [], owners: {}, maps: {}, sha256: "" });
    expect(() => joinPlanRepo(code, { plan: "acme/company-plan", planDir: checkoutOf(origin) })).toThrow("isn't committed. Commit it (git add nikos.plan.yaml");
    expect(git(code, "status", "--porcelain")).toContain("nikos.plan.yaml");
  });
});

describe("a link that lives on nikos/link", () => {
  it("pull on another branch says where the link is, and validate and doctor say the plan's settings don't apply there yet", () => {
    const origin = planOnOrigin();
    const code = joinedOnNikosLink(origin);
    expect(git(code, "branch", "--show-current")).toBe("main");
    expect(() => pullPlanSettings(code)).toThrow("is on nikos/link, not on this branch. Switch to it with git switch nikos/link");
    const warned = validate(code).warnings.filter((w) => w.file === "nikos.plan.yaml");
    expect(warned).toHaveLength(1);
    expect(warned[0].message).toContain("are on nikos/link, not on this branch");
    expect(validate(code).errors.filter((e) => e.file === "nikos.plan.yaml")).toEqual([]);
    expect(doctor(code, { offline: true }).find((c) => c.name === "plan settings")).toMatchObject({ status: "warn", found: expect.stringContaining("are on nikos/link, not on this branch") });
  });
});
