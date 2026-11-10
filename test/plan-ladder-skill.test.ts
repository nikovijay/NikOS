import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The ladder, direction and milestone wording of the nikos-plan skill. The general skill checks are in plan-skill.test.ts.
const skills = join(__dirname, "../skills/nikos-plan");
const read = (rel: string) => readFileSync(join(skills, rel), "utf8");

describe("nikos-plan skill: ladder, direction and milestones", () => {
  it("links the ladder playbook from the skill's table, and the file exists", () => {
    const skill = read("SKILL.md");
    expect(skill).toMatch(/\| ladder \| `playbooks\/ladder\.md` \|/);
    expect(existsSync(join(skills, "playbooks/ladder.md"))).toBe(true);
  });

  it("has the ladder playbook accept only after the person picks, and never an invented id", () => {
    const ladder = read("playbooks/ladder.md");
    expect(ladder).toContain("nikos plan ladder accept <id> <candidate>");
    expect(ladder).toMatch(/only after the person picks/);
    expect(ladder).toMatch(/Never invent an id/);
    expect(ladder).toMatch(/not linked yet/);
  });

  it("marks a milestone with kr step, and never checks it in with a value", () => {
    const checkin = read("playbooks/checkin.md");
    expect(checkin).toContain("nikos plan kr step <kr-id>");
    expect(checkin).toMatch(/`checkin` refuses one/);
    expect(checkin).toMatch(/moved the wrong way/);
  });

  it("gives the wizard direction, steps and text for a link that isn't known yet", () => {
    const wizard = read("playbooks/wizard.md");
    expect(wizard).toContain("--direction down");
    expect(wizard).toContain("--kind milestone --step");
    expect(wizard).toContain("--ladders-up");
  });
});
