import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../src/commands/validate";
import { show } from "../src/commands/show";
import { betsFor } from "../src/lib/bets";
import { copyExample, edit, rootOf } from "./helpers";

// A map names its one bet in bet: (its releases and stories name none); the bet lives in planning/.

const errors = (dir: string) => validate(dir).errors.map((e) => `${e.file}: ${e.message}`);
const addBet = (mapDir: string, id: string) => {
  const p = join(rootOf(mapDir), "planning/bets", `${id}.md`);
  mkdirSync(join(rootOf(mapDir), "planning/bets"), { recursive: true });
  writeFileSync(p, `---\nid: ${id}\n---\n`);
};
const setBet = (mapDir: string, from: string, to: string) => edit(join(mapDir, "storymap.yaml"), (s) => s.replace(from, to));

describe("bet links", () => {
  it("a map's bet that exists in planning/ validates", () => {
    const dir = copyExample();
    setBet(dir, "bet: fewer-missed-tasks", "bet: faster-checkout");
    addBet(dir, "faster-checkout");
    expect(errors(dir)).toEqual([]);
  });

  it("a bet is checked for its form only: its card in planning/ is not looked up", () => {
    const dir = copyExample();
    setBet(dir, "bet: fewer-missed-tasks", "bet: faster-checkout");
    expect(errors(dir).filter((e) => e.includes("faster-checkout"))).toEqual([]);
  });

  it("a map names one bet by its id: another repo's bet, as repo#id, is refused", () => {
    const dir = copyExample();
    setBet(dir, "bet: fewer-missed-tasks", "bet: acme/company-plan#focus-mode");
    expect(errors(dir)).toContain("storymap.yaml: maps/ht names bet acme/company-plan#focus-mode, which is not a bet id");
    setBet(dir, "bet: acme/company-plan#focus-mode", "bet: acme#focus-mode");
    expect(errors(dir)).toContain("storymap.yaml: maps/ht names bet acme#focus-mode, which is not a bet id");
  });

  it("a story's own bets are refused: the map's bet covers every story", () => {
    const dir = copyExample();
    edit(join(dir, "storymap.yaml"), (s) => `${s}story_bets:\n  HT-2: [acme/company-plan#focus-mode]\n`);
    expect(errors(dir)).toContain("storymap.yaml: maps/ht names its bet in bet:, so releases and stories don't name bets: remove story_bets from HT-2");
    // The lookup itself: a story's own bets replace its release's, for a map that names none in bet:.
    const map = { releases: [{ number: 1, bets: ["a"], stories: ["HT-1", "HT-2"] }], story_bets: { "HT-2": ["b"] } };
    expect(betsFor(map, "HT-1")).toEqual({ bets: ["a"], from: "release", release: 1 });
    expect(betsFor(map, "HT-2")).toEqual({ bets: ["b"], from: "story", release: 1 });
  });
});

describe("nikos show", () => {
  it("lists the map's bet for each story", () => {
    const dir = copyExample();
    expect(show("HT-1", dir)).toContain("Bets: fewer-missed-tasks — from the story map");
    expect(show("HT-3", dir)).toContain("Bets: fewer-missed-tasks — from the story map");
  });

  it("names no bets when the map names none", () => {
    const dir = copyExample();
    edit(join(dir, "storymap.yaml"), (s) => s.replace("bet: fewer-missed-tasks\n", ""));
    expect(show("HT-2", dir)).toContain("Bets: none");
  });
});
