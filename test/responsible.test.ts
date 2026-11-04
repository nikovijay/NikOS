import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const skill = readFileSync(join(__dirname, "../skills/clear/SKILL.md"), "utf8");
/** The Responsible table: area → what the story must cover. */
const bar = new Map([...skill.matchAll(/^  \| ([^|]+?) \| ([^|]+?) \|$/gm)].slice(2).map((m) => [m[1]!, m[2]!]));

describe("Responsible bar", () => {
  it("names what each sensitive area must cover", () => {
    expect([...bar.keys()].map((a) => a.split(" (")[0])).toEqual(["Money", "Personal data", "Safety", "Outreach to real people", "A screen people use"]);
    expect(bar.get("Personal data")).toMatch(/Who can see it.*deleting it/);
    expect(bar.get("Outreach to real people")).toMatch(/consent or opting out.*sign-off/);
  });

  it("fails a money story with no scenario for invalid amounts and names the missing scenario", () => {
    expect(bar.get("Money")).toMatch(/A scenario for invalid amounts \(zero, negative/);
    expect(skill).toMatch(/Any missing item fails Responsible: name the item and give\s+the scenario to add/);
    expect(skill).toContain("`Responsible: fail. Money: no scenario for invalid amounts. Fix: add \"AC3 — A zero or negative amount is refused\".`");
  });
});
