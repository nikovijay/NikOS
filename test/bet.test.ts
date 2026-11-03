import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newBet, parseBet, type BetInput } from "../src/commands/bet";
import { validate } from "../src/commands/validate";
import { copyExample, edit } from "./helpers";

const input: BetInput = {
  id: "faster-reorder",
  hypothesis: "We believe drag to reorder will make people plan their day in the app because they reorder on paper today.",
  keyResult: "Share of daily users who reorder at least once",
  expectedUplift: "from 10% to 30%",
  timeBox: "2026-12-01",
  stories: ["HT-3"],
  blockers: ["No usage analytics yet"],
};
const errors = (dir: string) => validate(dir).errors.map((e) => `${e.file}: ${e.message}`);

describe("bets", () => {
  it("saves a bet card with every field, linked to its stories, that validates", () => {
    const dir = copyExample();
    const path = newBet(input, dir);
    expect(path).toBe(join(dir, "bets/faster-reorder.md"));
    const bet = parseBet(readFileSync(path, "utf8"))!;
    expect(bet.meta).toEqual({
      id: "faster-reorder",
      hypothesis: input.hypothesis,
      key_result: input.keyResult,
      expected_uplift: input.expectedUplift,
      time_box: "2026-12-01",
      blockers: ["No usage analytics yet"],
      stories: ["HT-3"],
      status: "open",
    });
    expect(bet.body).toContain("## Outcome");
    expect(errors(dir)).toEqual([]);
  });

  it("refuses a bet with a missing field, no stories, or stories not in the map", () => {
    const dir = copyExample();
    expect(() => newBet({ ...input, keyResult: " " }, dir)).toThrow("key result");
    expect(() => newBet({ ...input, timeBox: "next month" }, dir)).toThrow("time box");
    expect(() => newBet({ ...input, stories: [] }, dir)).toThrow("at least one story");
    expect(() => newBet({ ...input, stories: ["HT-3", "HT-99"] }, dir)).toThrow("Not in storymap.yaml: HT-99");
    expect(() => newBet({ ...input, id: "Faster Reorder" }, dir)).toThrow("not a bet id");
  });

  it("never overwrites an existing bet", () => {
    const dir = copyExample();
    const path = newBet(input, dir);
    edit(path, (s) => s.replace("The evidence behind the hypothesis.", "Paper planners."));
    expect(() => newBet(input, dir)).toThrow("already exists");
    expect(readFileSync(path, "utf8")).toContain("Paper planners.");
  });

  it("a bet linking unknown stories fails validate", () => {
    const dir = copyExample();
    const path = newBet(input, dir);
    edit(path, (s) => s.replace("stories: [HT-3]", "stories: [HT-3, HT-99]"));
    expect(errors(dir)).toContain("bets/faster-reorder.md: links HT-99, which is not in storymap.yaml");
  });

  it("validate checks the fields, status and id of every bet card", () => {
    const dir = copyExample();
    const path = newBet(input, dir);
    edit(path, (s) => s.replace(/^key_result: .*\n/m, "").replace("status: open", "status: maybe"));
    writeFileSync(join(dir, "bets/notes.md"), "Just notes.\n");
    const found = errors(dir);
    expect(found).toContain("bets/faster-reorder.md: missing required field 'key_result'");
    expect(found).toContain("bets/faster-reorder.md: status 'maybe' is not one of open, won, lost, killed");
    expect(found).toContain("bets/notes.md: has no front matter");

    const other = copyExample();
    edit(newBet(input, other), (s) => s.replace("id: faster-reorder", "id: slower-reorder"));
    expect(errors(other)).toContain("bets/faster-reorder.md: id 'slower-reorder' doesn't match the file name");
  });
});

describe("bet playbook", () => {
  const playbook = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/bet.md"), "utf8");
  const index = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/index.md"), "utf8");

  it("frames the bet with the person, writes the card and closes it with a decision", () => {
    const steps = [...playbook.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
    expect(steps).toHaveLength(8);
    for (const part of ["hypothesis", "key result", "expected uplift", "time box", "blockers", "nikos bet new", "nikos validate", "## Outcome", "nikos decide"]) {
      expect(steps.some((s) => s.includes(part)), part).toBe(true);
    }
    expect(index).toMatch(/^\| bet \| `bet\.md` \|/m);
  });
});
