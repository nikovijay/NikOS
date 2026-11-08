// nikos doctor's migration hints: a 0.2.x intent/ repo is never failed, a team plan is flagged,
// a runner that doesn't run the story folder is warned, and a healthy group repo gets nothing new.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctor } from "../src/commands/doctor";
import { copyExample } from "./helpers";
import { groupRepo, teamRepo, write } from "./team-fixture";

describe("doctor on a 0.2.x intent/ repo", () => {
  it("a repo with a team plan that still has key results: the story map hints at both moves, and nothing fails", () => {
    const root = join(copyExample(), "..");
    const checks = doctor(root, { offline: true });
    const story = checks.find((c) => c.name === "story map")!;
    expect(story.status).toBe("ok");
    expect(story.next).toContain("Team plans are going away");
    expect(story.next).toContain("nikos migrate maps moves it under a group plan.");
    // The example has no runner yet, which doctor has always failed; nothing else fails.
    expect(checks.filter((c) => c.status === "fail").map((c) => c.name)).toEqual(["scenario runner"]);
  });

  it("a repo with no plan gets only the migrate hint, and no plan check", () => {
    const root = join(copyExample(), "..");
    rmSync(join(root, "planning", "plan.yaml"), { force: true });
    const checks = doctor(root, { offline: true });
    // The example ids are this repo's: its map key, and the group key migrate suggests from the folder name.
    expect(checks.find((c) => c.name === "story map")!.next).toMatch(/^nikos migrate maps moves it under a group plan\. Story ids without the group key stop it unless you pass --rename-ids \(([A-Z][A-Z0-9]*)-1 becomes [A-Z][A-Z0-9]*-\1-1\)\. Nothing moves until you confirm\.$/);
    expect(checks.some((c) => c.name === "plan")).toBe(false);
  });

  it("a 0.2.x repo with a warning still gets the team plan and migrate hints", () => {
    const intent = copyExample();
    const root = join(intent, "..");
    // The feature is tagged release 2, but the story map puts HT-2 in release 1: a warning.
    const feature = join(intent, "features/tasks/see-todays-top-three.feature");
    writeFileSync(feature, readFileSync(feature, "utf8").replace("@release-1", "@release-2"));
    const story = doctor(root, { offline: true }).find((c) => c.name === "story map")!;
    expect(story.status).toBe("warn");
    expect(story.next).toContain("Run nikos validate to see the warnings");
    expect(story.next).toContain("Team plans are going away");
    expect(story.next).toContain("nikos migrate maps moves it under a group plan.");
  });

  it("a plan that doesn't parse doesn't stop the checks: the story map and the runner still print", () => {
    const root = join(copyExample(), "..");
    writeFileSync(join(root, "planning", "plan.yaml"), "level: [company\n");
    const names = doctor(root, { offline: true }).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["story map", "scenario runner"]));
  });

  it("a runner that lists its paths without the story folder is warned, and a runner with no paths passes", () => {
    const root = join(copyExample(), "..");
    writeFileSync(join(root, "cucumber.mjs"), 'export default {\n  paths: ["test/features/**/*.feature"],\n};\n');
    expect(doctor(root, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "warn", found: "cucumber.mjs doesn't list the story's features folder" });
    writeFileSync(join(root, "cucumber.mjs"), "export default {};\n");
    expect(doctor(root, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "ok" });
  });
});

describe("doctor on a team repo's runner", () => {
  it("warns when the runner has no folder of step definitions, and passes when it has one", () => {
    const t = teamRepo();
    write(join(t, "behave.ini"), "[behave]\npaths = .nikos/assigned\n");
    expect(doctor(t, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "warn", found: "behave.ini has no steps/ folder of step definitions" });
    mkdirSync(join(t, "steps"));
    expect(doctor(t, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "ok", found: "behave.ini" });
  });
});

describe("doctor on a team repo with a team plan", () => {
  it("flags the plan with the same suggestion", () => {
    const team = teamRepo();
    write(join(team, "planning/plan.yaml"), "name: Checkout web\nperiod: Q4 2026\nlevel: team\npillars: []\n");
    const plan = doctor(team, { offline: true }).find((c) => c.name === "plan");
    expect(plan).toMatchObject({ status: "warn", found: "team plan in planning/plan.yaml" });
    expect(plan!.next).toContain("Move each key result to the department's plan");
  });

  it("says where a team repo's old story map goes", () => {
    const team = teamRepo();
    mkdirSync(join(team, "intent"));
    const clash = doctor(team, { offline: true }).find((c) => c.name === "team");
    expect(clash).toMatchObject({ status: "fail", found: "this repo has intent/ or maps/ and nikos.team.yaml: keep one" });
    expect(clash!.next).toBe("Move intent/ into a group repo with nikos migrate maps there, then delete it here.");
  });
});

describe("doctor on a group repo", () => {
  it("a comment that names the maps folder doesn't count as running it", () => {
    const root = groupRepo("PAY");
    writeFileSync(join(root, "behave.ini"), "# paths = maps/<key>/features\n[behave]\npaths = intent/features\n");
    expect(doctor(root, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "warn" });
    writeFileSync(join(root, "behave.ini"), "# paths = maps/<key>/features\n[behave]\npaths =\n    maps/chk/features\n");
    expect(doctor(root, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "ok" });
  });

  it("the plan line says it is a group with story maps, not a plan-only repo", () => {
    const root = groupRepo("PAY");
    // The fixture's bet card is a stub; a complete one keeps the plan's checks clean.
    write(join(root, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\nowner: Product\nhypothesis: Faster checkout keeps people paying.\nkrs:\n  also: []\nreview_on: 2027-01-15\nconfidence: medium\ndependencies: []\noutcome: open\nreviews: []\n---\n\n## Why we think so\nTesters said checkout is slow.\n");
    const plan = doctor(root, { offline: true }).find((c) => c.name === "plan")!;
    expect(plan.found).toMatch(/^group: /);
    expect(plan.found).toContain("story maps in maps/");
    expect(plan.found).not.toContain("no story map needed");
  });

  it("a runner that doesn't name maps/ is warned, and one that does is ok", () => {
    const root = groupRepo("PAY");
    writeFileSync(join(root, "cucumber.mjs"), 'export default {\n  paths: ["intent/features/**/*.feature"],\n};\n');
    expect(doctor(root, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "warn" });
    writeFileSync(join(root, "cucumber.mjs"), 'export default {\n  paths: ["maps/*/features/**/*.feature"],\n};\n');
    expect(doctor(root, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "ok" });
  });
});

