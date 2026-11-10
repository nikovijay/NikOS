// Story-id commands find their map from the id, in a repo with several maps. An id held by two maps,
// or an id and --map that disagree, is refused. Git gates cover a solo map too (with no planning/ folder).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { newMap } from "../src/commands/map";
import { newStory, removeStory, renameStory } from "../src/commands/story";
import { moveStory } from "../src/commands/release";
import { newPlan } from "../src/commands/plan";
import { setState } from "../src/commands/state";
import { show } from "../src/commands/show";
import { next } from "../src/commands/next";
import { approve } from "../src/commands/approve";
import { verify } from "../src/commands/verify";
import { headOf } from "../src/lib/git";
import { git, write, commitAll, groupRepo } from "./repo-fixture";

vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
beforeEach(() => vi.mocked(verify).mockClear());

const payFeature = (g: string) => join(g, "maps/pay/features/getting-started/pay-now.feature");
const stateOf = (dir: string, map: string) => parse(readFileSync(join(dir, "maps", map, "state.yaml"), "utf8")).stories ?? {};
const storymapOf = (dir: string, map: string) => parse(readFileSync(join(dir, "maps", map, "storymap.yaml"), "utf8"));

/** A group repo with two maps: maps/chk (PAY-CHK-1 to 3) and maps/pay (PAY-PAY-1), committed. */
function twoMaps(): string {
  const g = groupRepo("PAY");
  newMap({ bet: "faster-checkout", key: "PAY" }, g);
  newStory({ title: "Pay now", activity: "getting-started", map: "pay" }, g);
  commitAll(g, "second map");
  return g;
}

describe("story-id commands find the map from the id", () => {
  it("state set moves a story in the map that holds it, with no --map", () => {
    const g = twoMaps();
    setState("PAY-PAY-1", "in_progress", { dir: g });
    expect(stateOf(g, "pay")["PAY-PAY-1"].status).toBe("in_progress");
    expect(stateOf(g, "chk")["PAY-PAY-1"]).toBeUndefined();
  });

  it("plan new writes the plan into the map that holds the story", () => {
    const g = twoMaps();
    newPlan("PAY-PAY-1", { dir: g });
    expect(existsSync(join(g, "maps/pay/plans/PAY-PAY-1.v1.md"))).toBe(true);
    expect(existsSync(join(g, "maps/chk/plans/PAY-PAY-1.v1.md"))).toBe(false);
  });

  it("story rename changes the feature in the map that holds it", () => {
    const g = twoMaps();
    renameStory(g, { id: "PAY-PAY-1", title: "Pay with a card" });
    expect(readFileSync(payFeature(g), "utf8")).toContain("Feature: Pay with a card");
  });

  it("story remove takes the story out of the map that holds it, and no other", () => {
    const g = twoMaps();
    removeStory(g, { id: "PAY-PAY-1" });
    expect(existsSync(payFeature(g))).toBe(false);
    expect(storymapOf(g, "pay").releases[0].stories).toEqual([]);
    expect(storymapOf(g, "chk").releases[0].stories).toEqual(["PAY-CHK-1", "PAY-CHK-2"]);
  });

  it("release move finds the map from the story id", () => {
    const g = twoMaps();
    moveStory({ id: "PAY-CHK-3", to: 1 }, g);
    expect(storymapOf(g, "chk").releases[0].stories).toEqual(["PAY-CHK-1", "PAY-CHK-2", "PAY-CHK-3"]);
    expect(storymapOf(g, "pay").releases[0].stories).toEqual(["PAY-PAY-1"]);
  });

  it("show reads the story from the map that holds it", () => {
    const g = twoMaps();
    expect(show("PAY-PAY-1", g)).toContain("PAY-PAY-1 — Pay now");
  });

  it("approve writes the approval into the map that holds the story", () => {
    const g = twoMaps();
    setState("PAY-PAY-1", "in_progress", { dir: g });
    setState("PAY-PAY-1", "done", { dir: g });
    commitAll(g, "done");
    approve("PAY-PAY-1", { dir: g, by: "Priya Shah", date: "2027-01-06" });
    expect(existsSync(join(g, "maps/pay/approvals/PAY-PAY-1.yaml"))).toBe(true);
    expect(existsSync(join(g, "maps/chk/approvals/PAY-PAY-1.yaml"))).toBe(false);
  });
});

describe("commands with no id need --map when a repo has several maps", () => {
  it("next refuses with two maps and names them, and picks the one --map names", () => {
    const g = twoMaps();
    expect(() => next(g)).toThrow("several story maps (chk, pay): pass --map <id>");
    expect(next(g, "pay").story).toBe("PAY-PAY-1");
  });
});

describe("refusals when an id is in no map, in two maps, or disagrees with --map", () => {
  it("names the id that no map has", () => {
    const g = twoMaps();
    expect(() => setState("PAY-XX-9", "in_progress", { dir: g })).toThrow("no story map has PAY-XX-9");
  });

  it("refuses an id that two maps hold, and asks for --map", () => {
    const g = twoMaps();
    write(join(g, "maps/pay/features/extra/also-chk.feature"), "@PAY-CHK-1 @release-1\nFeature: Also in pay\n");
    expect(() => setState("PAY-CHK-1", "in_progress", { dir: g })).toThrow("PAY-CHK-1 is in several story maps (chk, pay): pass --map");
  });

  it("refuses --map that names another map than the one holding the id", () => {
    const g = twoMaps();
    expect(() => setState("PAY-CHK-1", "in_progress", { dir: g, map: "pay" })).toThrow("PAY-CHK-1 is not in maps/pay");
    expect(stateOf(g, "chk")["PAY-CHK-1"].status).toBe("todo");
  });
});

describe("git gates for a solo map (no planning/ folder)", () => {
  /** A solo repo with one map and one story, committed. */
  function solo(): string {
    const dir = mkdtempSync(join(tmpdir(), "nikos-solo-gate-"));
    write(join(dir, "src/app.ts"), "export const app = 1;\n");
    newMap({ key: "HT" }, dir);
    newStory({ title: "Add a task", activity: "getting-started" }, dir);
    git(dir, "init", "-q", "-b", "main");
    commitAll(dir, "start");
    return dir;
  }

  it("approve refuses uncommitted code, and approves once the code is committed", () => {
    const dir = solo();
    try {
      expect(headOf(dir)).toBeDefined();
      setState("HT-1", "in_progress", { dir });
      setState("HT-1", "done", { dir });
      commitAll(dir, "done");
      writeFileSync(join(dir, "src/app.ts"), "export const app = 2;\n");
      expect(() => approve("HT-1", { dir, by: "Priya Shah" })).toThrow("the code has uncommitted changes");
      commitAll(dir, "code");
      // The code changed after the proof ran, so the story is tested again before approval.
      expect(() => approve("HT-1", { dir, by: "Priya Shah" })).toThrow("the code has changed since");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("approve records the tested commit in a solo map", () => {
    const dir = solo();
    try {
      setState("HT-1", "in_progress", { dir });
      setState("HT-1", "done", { dir });
      const tested = headOf(dir);
      commitAll(dir, "done");
      approve("HT-1", { dir, by: "Priya Shah", date: "2027-01-06" });
      expect(parse(readFileSync(join(dir, "maps/ht/approvals/HT-1.yaml"), "utf8"))).toMatchObject({ tested_commit: tested });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
