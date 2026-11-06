import { describe, it, expect } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validate, formatResult } from "../src/commands/validate";
import { copyExample, edit, exampleDir } from "./helpers";

const messages = (dir: string) => validate(dir).errors.map((e) => `${e.file}: ${e.message}`);

describe("validate", () => {
  it("passes the hello-todo example", () => {
    const r = validate(exampleDir);
    expect(r.errors).toEqual([]);
    expect(formatResult(r)).toBe("✓ intent/ is valid — 3 stories, 2 releases");
  });

  it("fails on unknown status with a clear message", () => {
    const dir = copyExample();
    edit(join(dir, "state.yaml"), (s) => s.replace("status: todo", "status: blocked"));
    expect(messages(dir)).toContain(
      "state.yaml: stories.HT-3.status 'blocked' is not one of todo, in_progress, needs_rework, done, approved, cancelled",
    );
  });

  it("fails on missing story id", () => {
    const dir = copyExample();
    edit(join(dir, "features/tasks/reorder-tasks.feature"), (s) => s.replace("@HT-3 ", ""));
    const out = messages(dir);
    expect(out).toContain("features/tasks/reorder-tasks.feature: has no story id tag");
    expect(out).toContain("storymap.yaml: HT-3 has no feature file");
  });

  it("fails on a story id that isn't in the story map", () => {
    const dir = copyExample();
    edit(join(dir, "state.yaml"), (s) => s.replace("run:", "  HT-9:\n    status: todo\nrun:"));
    expect(messages(dir)).toContain("state.yaml: stories.HT-9 is an unknown story id");
  });

  it("fails on a malformed story id in state", () => {
    const dir = copyExample();
    edit(join(dir, "state.yaml"), (s) => s.replace("run:", "  task-9:\n    status: todo\nrun:"));
    expect(messages(dir)).toContain(
      "state.yaml: stories: 'task-9' is not a valid story id (expected e.g. HT-1)",
    );
  });

  it("fails when a required file is missing", () => {
    const dir = copyExample();
    rmSync(join(dir, "state.yaml"));
    const r = validate(dir);
    expect(r.errors[0]).toMatchObject({ file: "state.yaml", message: "file is missing" });
    expect(r.errors[0].hint).toContain("nikos init");
  });

  it("fails on unknown fields and invalid YAML", () => {
    const dir = copyExample();
    edit(join(dir, "storymap.yaml"), (s) => s + "colour: blue\n");
    expect(messages(dir)).toContain("storymap.yaml: unknown field 'colour'");
    writeFileSync(join(dir, "state.yaml"), "stories: [unclosed\n");
    expect(messages(dir).some((m) => m.startsWith("state.yaml: is not valid YAML"))).toBe(true);
  });

  it("fails on release gaps and duplicate stories", () => {
    const dir = copyExample();
    edit(join(dir, "storymap.yaml"), (s) => s.replace("number: 2", "number: 3").replace("stories: [HT-3]", "stories: [HT-3, HT-1]"));
    const out = messages(dir);
    expect(out.some((m) => m.includes("release numbers must start at 1 with no gaps"))).toBe(true);
    expect(out).toContain("storymap.yaml: HT-1 appears in more than one release");
  });

  it("runs the Gherkin lint on every feature", () => {
    const dir = copyExample();
    edit(join(dir, "features/tasks/reorder-tasks.feature"), (s) => s.replace("@HT-3 ", "@HT-3 @wip "));
    const r = validate(dir);
    expect(r.errors).toContainEqual({
      file: "features/tasks/reorder-tasks.feature",
      message: "uses status tag @wip",
      hint: "status lives in state.yaml, not in the feature",
    });
  });
});
