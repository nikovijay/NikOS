// The story map edits the dashboard sends: each op's file result, the checks the commands run after it,
// the refusals, and what a change does to a done story's proof and approval.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { lintFeature } from "../src/lint/gherkin";
import { storyMapOf } from "../src/commands/map";
import { validate } from "../src/commands/validate";
import { runOp, runOps } from "../src/planning/ops";
import { hash } from "../src/planning/model";
import { specHash } from "../src/lib/project";
import { narrativeOf } from "../src/lib/feature-edit";
import { commitAll, companyRepo, groupRepo, readText, write } from "./planning-fixture";

const PAY1 = "maps/chk/features/pay/pay-by-card.feature";
const PAY3 = "maps/chk/features/confirm/see-receipt.feature";
/** PAY-CHK-3 once it is placed under activity pay: its feature moves into that activity's folder. */
const PAY3_IN_PAY = "maps/chk/features/pay/see-receipt.feature";
const MAP = "maps/chk/storymap.yaml";

/** The temp repos a test makes, removed after it. */
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** A group repo with the test's cleanup. */
const group = (key: string) => {
  const g = groupRepo(key);
  made.push(g);
  return g;
};

/** The hash the page sends with an edit to a file. */
const fh = (g: string, path: string) => hash(readText(g, path));

/** The lint errors a feature has. */
const lintErrors = (text: string) => lintFeature(text).filter((i) => i.level === "error");

/** A story's line in the map, by id, from the dashboard's reading of it. */
const storyOf = (g: string, id: string) => storyMapOf(g).releases.flatMap((r) => r.stories).find((s) => s.id === id)!;

describe("persona.new", () => {
  it("adds a persona with an id made from its title, and the map still validates", () => {
    const g = group("PAY");
    const r = runOp(g, { op: "persona.new", args: { map: "chk", title: "Card shopper", description: "Pays by card" }, expect: fh(g, MAP) });
    expect(r.message).toBe("Added persona card-shopper");
    expect(readText(g, MAP)).toMatch(/personas:\n {2}- id: card-shopper\n {4}title: Card shopper\n {4}description: Pays by card/);
    expect(r.changed).toContain(MAP);
    expect(validate(g, "chk").errors).toEqual([]);
  });

  it("refuses a second persona with the same id, a blank title, and a stale expect", () => {
    const g = group("PAY");
    runOp(g, { op: "persona.new", args: { map: "chk", title: "Card shopper" } });
    expect(() => runOp(g, { op: "persona.new", args: { map: "chk", title: "card  shopper" } })).toThrow("There is already a persona 'card-shopper' in maps/chk");
    expect(() => runOp(g, { op: "persona.new", args: { map: "chk", title: " " } })).toThrow("A persona needs a title");
    expect(() => runOp(g, { op: "persona.new", args: { map: "chk", title: "Other" }, expect: "0000000000000000" })).toThrow(/storymap\.yaml changed on disk/);
  });
});

describe("story.edit", () => {
  it("rewrites the title, narrative, type, personas and priority, and keeps the placement", () => {
    const g = group("PAY");
    runOp(g, { op: "persona.new", args: { map: "chk", title: "Card shopper" } });
    const state = readText(g, "maps/chk/state.yaml");
    const r = runOp(g, {
      op: "story.edit",
      target: { story: "PAY-CHK-1" },
      args: { map: "chk", title: "Pay by card", as_a: "cashier", i_want: "to take a card", so_that: "the till balances", type: "technical", personas: ["card-shopper"], priority: "should" },
      expect: fh(g, PAY1),
    });
    expect(r.message).toBe("Saved PAY-CHK-1");
    const after = readText(g, PAY1);
    expect(after).toContain("Feature: Pay by card");
    expect(after).toContain("  As a cashier\n  I want to take a card\n  So that the till balances");
    expect(after.split("\n")[0]).toBe("@PAY-CHK-1 @persona-card-shopper @type-technical @release-1 @should @activity-pay");
    expect(lintErrors(after)).toEqual([]);
    expect(r.changed).toContain(PAY1);
    expect(readText(g, "maps/chk/state.yaml")).toBe(state);
    expect(validate(g, "chk").errors).toEqual([]);
  });

  it("refuses a persona the map doesn't name, a blank title, and a stale expect", () => {
    const g = group("PAY");
    expect(() => runOp(g, { op: "story.edit", target: { story: "PAY-CHK-1" }, args: { map: "chk", personas: ["nobody"] }, expect: fh(g, PAY1) })).toThrow(
      "'nobody' is not a persona in maps/chk: add it under personas first",
    );
    expect(() => runOp(g, { op: "story.edit", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: " " }, expect: fh(g, PAY1) })).toThrow("A story needs a title");
    expect(() => runOp(g, { op: "story.edit", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: "Pay" }, expect: "0000000000000000" })).toThrow(
      "PAY-CHK-1 changed on disk since it was loaded",
    );
  });

  it("needs its expect in a dry run, as the other edits do", () => {
    const g = group("PAY");
    const dry = runOps(g, [{ op: "story.edit", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: "Pay" } }]);
    expect(dry.results[0]).toMatchObject({ ok: false, message: "story.edit needs the expect the snapshot gave: export again" });
  });

  it("refuses a stub story (in a release, with no feature file) with a clear message", () => {
    const g = group("PAY");
    write(join(g, MAP), readText(g, MAP).replace("stories: [PAY-CHK-1, PAY-CHK-2]", "stories: [PAY-CHK-1, PAY-CHK-2, PAY-CHK-9]"));
    expect(() => runOp(g, { op: "story.edit", target: { story: "PAY-CHK-9" }, args: { map: "chk", title: "Later" } })).toThrow(
      "PAY-CHK-9 has no feature file yet, so it can't be edited here",
    );
    expect(() => runOp(g, { op: "story.place", target: { story: "PAY-CHK-9" }, args: { map: "chk", activity: "pay" } })).toThrow(
      "PAY-CHK-9 has no feature file yet, so it can't be edited here",
    );
  });
});

/** A done story whose proof and sign-off are for its feature as it is now. */
function approvePay1(g: string): void {
  const doneAt = "2026-11-06T10:00:00Z";
  const spec = specHash(readText(g, PAY1));
  write(join(g, "maps/chk/state.yaml"), `format_version: 1\nstories:\n  PAY-CHK-1: { status: done, done_at: "${doneAt}", spec_hash: ${spec} }\n  PAY-CHK-2: { status: todo }\n  PAY-CHK-3: { status: todo }\n`);
  write(join(g, "maps/chk/approvals/PAY-CHK-1.yaml"), `by: Niko\non: 2026-11-06\nvia: terminal\nspec_hash: ${spec}\ndone_at: "${doneAt}"\n`);
  expect(storyOf(g, "PAY-CHK-1")).toMatchObject({ status: "approved", approvedBy: "Niko", specChanged: false });
}

const PAY1_TARGET = { story: "PAY-CHK-1" };

describe("a change to a done story's proof", () => {
  it("a type or persona change keeps the proof and the sign-off", () => {
    const g = group("PAY");
    runOp(g, { op: "persona.new", args: { map: "chk", title: "Card shopper" } });
    approvePay1(g);
    runOp(g, { op: "story.edit", target: PAY1_TARGET, args: { map: "chk", type: "bug_risk", personas: ["card-shopper"] }, expect: fh(g, PAY1) });
    expect(storyOf(g, "PAY-CHK-1")).toMatchObject({ status: "approved", approvedBy: "Niko", specChanged: false });
  });

  it("a type change keeps an indented narrative as it is, and the sign-off", () => {
    const g = group("PAY");
    // The narrative indented by four spaces, as a hand-written file might have it.
    write(join(g, PAY1), readText(g, PAY1).replace(/^  (As|I want|So that) /gm, "    $1 "));
    approvePay1(g);
    const before = readText(g, PAY1);
    const n = narrativeOf(before);
    // The page sends the whole narrative with the type, as the details form does.
    runOp(g, { op: "story.edit", target: PAY1_TARGET, args: { map: "chk", type: "technical", as_a: n.asA, i_want: n.iWant, so_that: n.soThat }, expect: fh(g, PAY1) });
    const after = readText(g, PAY1).split("\n");
    expect(after.slice(1)).toEqual(before.split("\n").slice(1));
    expect(after[0]).toContain("@type-technical");
    expect(storyOf(g, "PAY-CHK-1")).toMatchObject({ status: "approved", specChanged: false });
  });

  it.each([
    ["the title", "story.edit", { title: "Pay with a card" }],
    ["the narrative", "story.edit", { i_want: "to pay with a card" }],
    ["a criterion's steps", "scenario.edit", { ac: "AC1", title: "Pays", when: ["I pay"], then: ["I see a receipt"] }],
  ] as const)("a change to %s lapses the sign-off", (_part, op, args) => {
    const g = group("PAY");
    approvePay1(g);
    runOp(g, { op, target: PAY1_TARGET, args: { map: "chk", ...args }, expect: fh(g, PAY1) });
    expect(storyOf(g, "PAY-CHK-1")).toMatchObject({ status: "done", specChanged: true });
    expect(storyOf(g, "PAY-CHK-1").status).not.toBe("approved");
  });

  it("adding or removing a criterion lapses the sign-off", () => {
    const g = group("PAY");
    runOp(g, { op: "scenario.add", target: PAY1_TARGET, args: { map: "chk", title: "Declined", when: ["I pay with a declined card"], then: ["I see why"] }, expect: fh(g, PAY1) });
    approvePay1(g);
    runOp(g, { op: "scenario.remove", target: PAY1_TARGET, args: { map: "chk", ac: "AC2" }, expect: fh(g, PAY1) });
    expect(storyOf(g, "PAY-CHK-1")).toMatchObject({ status: "done", specChanged: true });
  });
});

describe("story.place", () => {
  it("moves a story to another release and places it under an activity and step", () => {
    const g = group("PAY");
    runOp(g, { op: "step.new", args: { map: "chk", activity: "pay", title: "Enter card" } });
    const r = runOp(g, { op: "story.place", target: { story: "PAY-CHK-3" }, args: { map: "chk", release: 1, activity: "pay", step: "enter-card" }, expect: fh(g, PAY3) });
    expect(r.message).toBe("Placed PAY-CHK-3 under pay");
    // The feature moved into the folder of its activity, and the old file is gone.
    expect(existsSync(join(g, PAY3))).toBe(false);
    expect(readText(g, PAY3_IN_PAY).split("\n")[0]).toBe("@PAY-CHK-3 @release-1 @must @activity-pay @step-enter-card");
    expect(lintErrors(readText(g, PAY3_IN_PAY))).toEqual([]);
    const map = readText(g, MAP);
    expect(map).toMatch(/- number: 1\n {4}title: First\n {4}stories: \[PAY-CHK-1, PAY-CHK-2, PAY-CHK-3\]/);
    expect(map).toMatch(/- number: 2\n {4}title: Second\n {4}stories: \[\]/);
    expect(r.changed).toEqual(expect.arrayContaining([PAY3_IN_PAY, PAY3, MAP]));
    expect(validate(g, "chk").errors).toEqual([]);
  });

  it("leaves the feature where it is when the activity stays, and a blank step clears the step tag", () => {
    const g = group("PAY");
    runOp(g, { op: "step.new", args: { map: "chk", activity: "pay", title: "Enter card" } });
    runOp(g, { op: "story.place", target: { story: "PAY-CHK-1" }, args: { map: "chk", activity: "pay", step: "enter-card" }, expect: fh(g, PAY1) });
    expect(readText(g, PAY1).split("\n")[0]).toBe("@PAY-CHK-1 @release-1 @must @activity-pay @step-enter-card");
    runOp(g, { op: "story.place", target: { story: "PAY-CHK-1" }, args: { map: "chk", activity: "pay", step: "" }, expect: fh(g, PAY1) });
    expect(readText(g, PAY1).split("\n")[0]).toBe("@PAY-CHK-1 @release-1 @must @activity-pay");
  });

  it("refuses an unknown activity, a step of another activity, a blank activity, and a stale expect", () => {
    const g = group("PAY");
    runOp(g, { op: "step.new", args: { map: "chk", activity: "pay", title: "Enter card" } });
    expect(() => runOp(g, { op: "story.place", target: { story: "PAY-CHK-3" }, args: { map: "chk", activity: "nope" }, expect: fh(g, PAY3) })).toThrow(
      "'nope' is not an activity in storymap.yaml",
    );
    expect(() => runOp(g, { op: "story.place", target: { story: "PAY-CHK-3" }, args: { map: "chk", activity: "confirm", step: "enter-card" }, expect: fh(g, PAY3) })).toThrow(
      "'enter-card' is not a step of activity 'confirm'",
    );
    expect(() => runOp(g, { op: "story.place", target: { story: "PAY-CHK-3" }, args: { map: "chk", activity: " " }, expect: fh(g, PAY3) })).toThrow("A story needs an activity");
    expect(() => runOp(g, { op: "story.place", target: { story: "PAY-CHK-3" }, args: { map: "chk", activity: "pay" }, expect: "0000000000000000" })).toThrow(/changed on disk/);
  });
});

describe("placing a story in no release", () => {
  it("puts it into the release it is given, and a blank release leaves it where it is", () => {
    const g = group("PAY");
    // PAY-CHK-1 is in no release: off release 1's list, and with no release tag on its feature.
    write(join(g, MAP), readText(g, MAP).replace("stories: [PAY-CHK-1, PAY-CHK-2]", "stories: [PAY-CHK-2]"));
    write(join(g, PAY1), readText(g, PAY1).replace("@release-1 ", ""));
    runOp(g, { op: "story.place", target: PAY1_TARGET, args: { map: "chk", release: "", activity: "pay", step: "" }, expect: fh(g, PAY1) });
    expect(readText(g, MAP)).toMatch(/- number: 1\n {4}title: First\n {4}stories: \[PAY-CHK-2\]/);
    expect(readText(g, PAY1).split("\n")[0]).not.toContain("@release-");
    runOp(g, { op: "story.place", target: PAY1_TARGET, args: { map: "chk", release: 2, activity: "pay", step: "" }, expect: fh(g, PAY1) });
    expect(readText(g, MAP)).toMatch(/- number: 2\n {4}title: Second\n {4}stories: \[PAY-CHK-3, PAY-CHK-1\]/);
    expect(readText(g, PAY1).split("\n")[0]).toContain("@release-2");
    expect(validate(g, "chk").errors).toEqual([]);
  });
});

describe("scenario ops", () => {
  it("adds a criterion numbered one past the highest, and the file still lints", () => {
    const g = group("PAY");
    const r = runOp(g, { op: "scenario.add", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: "Shows an error", when: ["I pay with a declined card"], then: ["I see an error"] }, expect: fh(g, PAY1) });
    expect(r.message).toBe("Added AC2 to PAY-CHK-1");
    expect(readText(g, PAY1)).toContain("  @AC2 @must\n  Scenario: AC2 — Shows an error\n    When I pay with a declined card\n    Then I see an error");
    expect(lintErrors(readText(g, PAY1))).toEqual([]);
    expect(r.changed).toContain(PAY1);
  });

  it("edits a criterion's title, priority and steps, and keeps its label", () => {
    const g = group("PAY");
    runOp(g, { op: "scenario.edit", target: { story: "PAY-CHK-1" }, args: { map: "chk", ac: "AC1", title: "Pays", priority: "could", when: ["I pay"], then: ["I see a receipt", "the total is right"] }, expect: fh(g, PAY1) });
    const text = readText(g, PAY1);
    expect(text).toContain("  @AC1 @could\n  Scenario: AC1 — Pays\n    When I pay\n    Then I see a receipt\n    And the total is right");
    expect(lintErrors(text)).toEqual([]);
  });

  it("refuses a criterion the story doesn't have, a label that isn't one, and a criterion with no When", () => {
    const g = group("PAY");
    expect(() => runOp(g, { op: "scenario.edit", target: { story: "PAY-CHK-1" }, args: { map: "chk", ac: "AC9", title: "x", when: ["a"], then: ["b"] }, expect: fh(g, PAY1) })).toThrow(
      "PAY-CHK-1 has no criterion AC9",
    );
    expect(() => runOp(g, { op: "scenario.remove", target: { story: "PAY-CHK-1" }, args: { map: "chk", ac: "one" }, expect: fh(g, PAY1) })).toThrow(
      "'one' is not a criterion label (AC1, AC2…)",
    );
    expect(() => runOp(g, { op: "scenario.add", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: "x", then: ["b"] }, expect: fh(g, PAY1) })).toThrow(
      "A criterion needs a When step",
    );
  });

  it("removes a criterion without renumbering, and refuses to remove the last one", () => {
    const g = group("PAY");
    expect(() => runOp(g, { op: "scenario.remove", target: { story: "PAY-CHK-1" }, args: { map: "chk", ac: "AC1" }, expect: fh(g, PAY1) })).toThrow(
      "A story keeps at least one criterion: add another before removing this one",
    );
    runOp(g, { op: "scenario.add", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: "Second", when: ["I act"], then: ["it works"] }, expect: fh(g, PAY1) });
    const r = runOp(g, { op: "scenario.remove", target: { story: "PAY-CHK-1" }, args: { map: "chk", ac: "AC1" }, expect: fh(g, PAY1) });
    expect(r.message).toBe("Removed AC1 from PAY-CHK-1");
    expect(readText(g, PAY1)).not.toContain("AC1");
    expect(readText(g, PAY1)).toContain("@AC2 @must");
    expect(lintErrors(readText(g, PAY1))).toEqual([]);
  });

  it("refuses a stale expect and writes nothing", () => {
    const g = group("PAY");
    const before = readText(g, PAY1);
    expect(() => runOp(g, { op: "scenario.add", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: "x", when: ["a"], then: ["b"] }, expect: "0000000000000000" })).toThrow(
      "PAY-CHK-1 changed on disk since it was loaded",
    );
    expect(readText(g, PAY1)).toBe(before);
  });
});

describe("creates check the map's hash, and refuse a name in use", () => {
  it("activity.new makes an id from the title, refuses one in use, and takes the expect", () => {
    const g = group("PAY");
    expect(runOp(g, { op: "activity.new", args: { map: "chk", title: "Refunds" }, expect: fh(g, MAP) }).message).toBe("Added activity refunds");
    expect(readText(g, MAP)).toContain("id: refunds");
    expect(() => runOp(g, { op: "activity.new", args: { map: "chk", title: "Pay" } })).toThrow("There is already an activity 'pay' in maps/chk");
    expect(() => runOp(g, { op: "activity.new", args: { map: "chk", title: "Tax" }, expect: "0000000000000000" })).toThrow(/storymap\.yaml changed on disk/);
    expect(() => runOp(g, { op: "activity.new", args: { map: "chk", title: "!!!" } })).toThrow("An activity needs a title with letters or numbers");
  });

  it("step.new makes an id from the title, refuses one in use", () => {
    const g = group("PAY");
    expect(runOp(g, { op: "step.new", args: { map: "chk", activity: "pay", title: "Enter card" }, expect: fh(g, MAP) }).message).toBe("Added step enter-card");
    expect(() => runOp(g, { op: "step.new", args: { map: "chk", activity: "pay", title: "Enter card" } })).toThrow("There is already a step 'enter-card'");
  });

  it("story.new and release.new take the storymap's expect", () => {
    const g = group("PAY");
    expect(() => runOp(g, { op: "story.new", args: { map: "chk", title: "Refund", activity: "pay", release: 1 }, expect: "0000000000000000" })).toThrow(/storymap\.yaml changed on disk/);
    expect(() => runOp(g, { op: "release.new", args: { map: "chk", title: "Later" }, expect: "0000000000000000" })).toThrow(/storymap\.yaml changed on disk/);
    expect(runOp(g, { op: "release.new", args: { map: "chk", title: "Later" }, expect: fh(g, MAP) }).message).toBe("Added release 3");
  });
});

describe("planning areas", () => {
  it("never make the story map ops", () => {
    const root = companyRepo();
    made.push(root);
    const co = join(root, "planning", "company");
    expect(() => runOp(co, { op: "story.edit", target: { story: "PAY-CHK-1" }, args: { title: "x" } })).toThrow("story.edit isn't a change a planning area makes");
    expect(() => runOp(co, { op: "persona.new", args: { title: "x" } })).toThrow("persona.new isn't a change a planning area makes");
    expect(() => runOp(co, { op: "scenario.add", target: { story: "PAY-CHK-1" }, args: { when: ["a"], then: ["b"] } })).toThrow("scenario.add isn't a change a planning area makes");
    commitAll(co, "noop");
  });
});
