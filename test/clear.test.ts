import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clear, featureFor, runClear } from "../src/commands/clear";
import { exampleDir } from "./helpers";

const story = (scenarios: string) => `@HT-9 @release-1 @must
Feature: Archive a task

  As a busy person
  I want to archive a finished task
  So that my list only shows what's left
${scenarios}`;

const good = story(`
  @AC1 @must
  Scenario: AC1 — Archiving hides the task
    Given I have the task "Call the bank"
    When I archive "Call the bank"
    Then I no longer see "Call the bank" on my list
`);

const byCheck = (text: string) => Object.fromEntries(clear(text).map((r) => [r.check, r]));

describe("clear", () => {
  it("fails Executable with no scenarios", () => {
    const r = byCheck(story(""));
    expect(r.Executable.status).toBe("fail");
    expect(r.Executable.message).toBe("has no scenarios");
    expect(r.Executable.fix).toBe("Add at least one Scenario for each acceptance criterion");
  });

  it("fails Executable when a scenario has no Then", () => {
    const r = byCheck(good.replace(/    Then .*\n/, ""));
    expect(r.Executable.status).toBe("fail");
    expect(r.Executable.message).toContain('"AC1 — Archiving hides the task" is missing a When or Then step');
  });

  it("flags implementation detail as not Lean", () => {
    expect(byCheck(good.replace("archive a finished task", "set archived in localStorage")).Lean.status).toBe("fail");
    expect(byCheck(good.replace("I archive", "src/archive.ts runs and I archive")).Lean.message).toContain('a file path ("src/archive.ts")');
    expect(byCheck(good.replace("I archive", "UPDATE tasks SET archived = 1 and I archive")).Lean.message).toContain("SQL");
  });

  it("doesn't flag ordinary words as frameworks", () => {
    expect(byCheck(good.replace("busy person", "person who wants to react quickly to a redis-coloured alert")).Lean.status).toBe("pass");
  });

  it("reports all five checks for a passing story", () => {
    const results = clear(good);
    expect(results.map((r) => r.check)).toEqual(["Clear", "Lean", "Executable", "Accurate", "Responsible"]);
    expect(results.filter((r) => r.status === "fail")).toEqual([]);
    expect(results.find((r) => r.check === "Executable")!.message).toBe("1 scenario, each with When and Then");
    for (const c of ["Clear", "Accurate", "Responsible"]) expect(results.find((r) => r.check === c)!.status).toBe("agent");
  });

  it("passes every story in the hello-todo example", () => {
    for (const id of ["HT-1", "HT-2", "HT-3"]) {
      const file = featureFor(id, exampleDir)!;
      expect(clear(readFileSync(file, "utf8")).filter((r) => r.status === "fail"), id).toEqual([]);
    }
  });

  it("finds a story by id and exits 1 for an unknown id", () => {
    expect(runClear(["HT-1", "--dir", exampleDir])).toBe(0);
    expect(runClear(["HT-99", "--dir", exampleDir])).toBe(1);
  });
});

describe("clear skill", () => {
  const skill = readFileSync(join(__dirname, "../skills/clear/SKILL.md"), "utf8");

  it("reports each of the five checks in order and stops on a fail", () => {
    const lines = [...skill.matchAll(/^(Clear|Lean|Executable|Accurate|Responsible): /gm)].map((m) => m[1]);
    expect(lines).toEqual(["Clear", "Lean", "Executable", "Accurate", "Responsible"]);
    expect(skill).toMatch(/One line per check, every time, even when it passes/);
    expect(skill).toMatch(/If any check fails, don't plan or build the story/);
    expect(skill).toMatch(/^name: clear$/m);
  });

  it("tells the agent to decide small unstated rules and record them with nikos decide", () => {
    const decide = skill.slice(skill.indexOf("**Decide it**"), skill.indexOf("**Stop and ask**"));
    expect(decide).toMatch(/how a tip rounds/);
    expect(decide).toMatch(/record it with\s+`nikos decide "<the rule>" --story <story-id>/);
    expect(skill).toMatch(/`Decided: <rule>`/);
  });

  it("tells the agent to stop and ask when a gap touches money, data or access", () => {
    const ask = skill.slice(skill.indexOf("**Stop and ask**"), skill.indexOf("## 4."));
    for (const area of ["money", "personal data", "access"]) expect(ask).toContain(area);
    expect(ask).toMatch(/Clear fails until the person answers/);
    expect(ask).toMatch(/If you're not sure which it is, ask/);
    expect(skill).toMatch(/`Ask: <question>`/);
  });
});
