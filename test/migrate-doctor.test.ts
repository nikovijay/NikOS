// nikos doctor: a repo still on intent/ fails with the migrate hint, a runner that doesn't run the
// story folder is warned, and a healthy group repo gets nothing new.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctor } from "../src/commands/doctor";
import { copyExample, rootOf } from "./helpers";
import { groupRepo, write } from "./repo-fixture";

describe("doctor on a repo with intent/", () => {
  it("fails the story map check and says to run nikos migrate maps", () => {
    const root = rootOf(copyExample());
    mkdirSync(join(root, "intent"));
    const story = doctor(root, { offline: true }).find((c) => c.name === "story map")!;
    expect(story).toMatchObject({ status: "fail", found: "this repo keeps its story map in intent/, the old layout" });
    expect(story.next).toContain("nikos migrate maps");
  });

  it("a plan that doesn't parse doesn't stop the checks: the story map and the runner still print", () => {
    const root = rootOf(copyExample());
    writeFileSync(join(root, "planning", "plan.yaml"), "level: [company\n");
    const names = doctor(root, { offline: true }).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["story map", "scenario runner"]));
  });

  it("a runner that lists its paths without the story folder is warned, and a runner with no paths passes", () => {
    const root = rootOf(copyExample());
    writeFileSync(join(root, "cucumber.mjs"), 'export default {\n  paths: ["test/features/**/*.feature"],\n};\n');
    expect(doctor(root, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "warn", found: "cucumber.mjs doesn't list the story's features folder" });
    writeFileSync(join(root, "cucumber.mjs"), "export default {};\n");
    expect(doctor(root, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "ok" });
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

