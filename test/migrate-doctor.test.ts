// nikos doctor: a repo still on intent/ fails with the migrate hint, a runner that doesn't run the
// story folder is warned, and a healthy group repo gets nothing new.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctor } from "../src/commands/doctor";
import { copyExample, rootOf } from "./helpers";
import { groupRepo, write } from "./repo-fixture";

describe("doctor on a repo with intent/", () => {
  it("fails the story map check and says to move intent/ by hand", () => {
    const root = rootOf(copyExample());
    mkdirSync(join(root, "intent"));
    const story = doctor(root, { offline: true }).find((c) => c.name === "story map")!;
    expect(story).toMatchObject({ status: "fail", found: "this repo keeps its story map in intent/, the old layout" });
    expect(story.next).toContain("by hand, as the release notes describe");
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

  it("a runner that doesn't name maps/ is warned, and one that does is ok", () => {
    const root = groupRepo("PAY");
    writeFileSync(join(root, "cucumber.mjs"), 'export default {\n  paths: ["intent/features/**/*.feature"],\n};\n');
    expect(doctor(root, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "warn" });
    writeFileSync(join(root, "cucumber.mjs"), 'export default {\n  paths: ["maps/*/features/**/*.feature"],\n};\n');
    expect(doctor(root, { offline: true }).find((c) => c.name === "scenario runner")).toMatchObject({ status: "ok" });
  });
});

