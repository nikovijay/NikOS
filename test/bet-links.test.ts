import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { validate } from "../src/commands/validate";
import { show } from "../src/commands/show";
import { betsFor } from "../src/lib/bets";
import { copyExample, edit } from "./helpers";

// Releases (and, as an override, single stories) name the bets they deliver; the bets live in planning/.

const errors = (dir: string) => validate(dir).errors.map((e) => `${e.file}: ${e.message}`);
const addBet = (intent: string, id: string) => {
  const p = join(dirname(intent), "planning/bets", `${id}.md`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `---\nid: ${id}\n---\n`);
};
const setBets = (intent: string, from: string, to: string) => edit(join(intent, "storymap.yaml"), (s) => s.replace(from, to));

describe("bet links", () => {
  it("a release naming an existing bet validates", () => {
    const dir = copyExample();
    setBets(dir, "bets: [fewer-missed-tasks]", "bets: [faster-checkout]");
    addBet(dir, "faster-checkout");
    expect(errors(dir)).toEqual([]);
  });

  it("a missing same-repo bet fails naming the release", () => {
    const dir = copyExample();
    setBets(dir, "bets: [fewer-missed-tasks]", "bets: [faster-checkout]");
    expect(errors(dir)).toContain("storymap.yaml: release 1 names bet 'faster-checkout', which has no planning/bets/faster-checkout.md");
  });

  it("cross-repo references are checked for form only", () => {
    const dir = copyExample();
    setBets(dir, "bets: [fewer-missed-tasks]", "bets: [acme/company-plan#focus-mode]");
    expect(errors(dir)).toEqual([]); // no planning/ for acme here, and nothing is fetched
    setBets(dir, "bets: [acme/company-plan#focus-mode]", "bets: [acme#focus-mode]");
    expect(errors(dir)).toContain("storymap.yaml: release 1 names bet 'acme#focus-mode', which is neither a bet id nor owner/repo#id");
  });

  it("a story's own bets replace its release's", () => {
    const dir = copyExample();
    edit(join(dir, "storymap.yaml"), (s) => `${s}story_bets:\n  HT-2: [acme/company-plan#focus-mode]\n`);
    expect(errors(dir)).toEqual([]);
    const map = { releases: [{ number: 1, bets: ["a"], stories: ["HT-1", "HT-2"] }], story_bets: { "HT-2": ["b"] } };
    expect(betsFor(map, "HT-1")).toEqual({ bets: ["a"], from: "release", release: 1 });
    expect(betsFor(map, "HT-2")).toEqual({ bets: ["b"], from: "story", release: 1 });
    edit(join(dir, "storymap.yaml"), (s) => s.replace("HT-2: [acme", "HT-9: [acme"));
    expect(errors(dir)).toContain("storymap.yaml: story_bets names HT-9, which is not in any release");
  });
});

describe("nikos show", () => {
  it("lists bets from the release", () => {
    const dir = copyExample();
    expect(show("HT-1", dir)).toContain("Bets: fewer-missed-tasks (planning/bets/fewer-missed-tasks.md) — from release 1");
    expect(show("HT-3", dir)).toContain("Bets: none");
  });

  it("lists a story's own bets", () => {
    const dir = copyExample();
    edit(join(dir, "storymap.yaml"), (s) => `${s}story_bets:\n  HT-2: [acme/company-plan#focus-mode]\n`);
    expect(show("HT-2", dir)).toContain("Bets: acme/company-plan#focus-mode — from the story");
  });
});
