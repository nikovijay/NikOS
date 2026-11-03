import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintFeature } from "../src/lint/gherkin";
import { exampleDir } from "./helpers";

const example = readFileSync(join(exampleDir, "intent/features/tasks/add-a-task.feature"), "utf8");
const errors = (text: string) => lintFeature(text).filter((i) => i.level === "error").map((i) => i.message);

describe("gherkin lint", () => {
  it("accepts the example feature", () => {
    expect(lintFeature(example)).toEqual([]);
  });

  it("rejects status tags", () => {
    expect(errors(example.replace("@HT-1 ", "@HT-1 @done "))).toContain("uses status tag @done");
    expect(errors(example.replace("@AC1 @must", "@AC1 @must @wip"))).toContain(
      'scenario "AC1 — Adding a task shows it at the top" uses status tag @wip',
    );
  });

  it("rejects a missing user story", () => {
    const text = example.replace("  As a busy person\n", "").replace("  So that capturing it is faster than forgetting it\n", "");
    expect(errors(text)).toContain('user story is missing "As a", "So that"');
  });

  it("accepts As an and As the as the role line", () => {
    expect(errors(example.replace("As a busy person", "As an admin"))).toEqual([]);
    expect(errors(example.replace("As a busy person", "As the person holding the bill"))).toEqual([]);
    expect(errors(example.replace("As a busy person", "Asa busy person"))).toContain('user story is missing "As a"');
  });

  it("requires each scenario to carry an AC label", () => {
    expect(errors(example.replace("@AC2 @should", "@should"))).toContain('scenario "AC2 — Blank tasks are ignored" has no @AC<n> tag');
    expect(errors(example.replace("@AC2", "@AC1"))).toContain("@AC1 is used by more than one scenario");
  });

  it("requires one feature, a priority and a release", () => {
    expect(errors(example + "\nFeature: Another\n")).toContain("has 2 Features");
    expect(errors(example.replace(" @must @activity", " @activity"))).toContain("needs exactly one priority tag on the Feature");
    expect(errors(example.replace("@release-1 ", ""))).toContain("has no @release-N tag");
  });

  it("requires When and Then steps", () => {
    expect(errors(example.replace('    Then my list is still empty\n', ""))).toContain('scenario "AC2 — Blank tasks are ignored" has no Then step');
  });

  it("warns, not fails, on a feature with no scenarios", () => {
    const text = example.slice(0, example.indexOf("  @AC1"));
    const issues = lintFeature(text);
    expect(issues).toEqual([{ level: "warning", message: "has no scenarios yet", hint: "add one Scenario per acceptance criterion" }]);
  });
});
