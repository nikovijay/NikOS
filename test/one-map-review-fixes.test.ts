// Paths the PR 2b review found, kept from coming back: several maps, story ids after a plan key is
// added, the 0.2 layouts that are refused rather than ignored, and the owner in the drift message.
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/commands/init";
import { runState } from "../src/commands/state";
import { runDecide } from "../src/commands/decide";
import { checkRelease } from "../src/commands/release";
import { newStory } from "../src/commands/story";
import { validate } from "../src/commands/validate";
import { askOnboarding } from "../src/commands/onboard";
import { writeMapSummary } from "../src/lib/map-summary";
import { groupRepo, write } from "./repo-fixture";

const fresh = () => mkdtempSync(join(tmpdir(), "nikos-review-"));
const messages = (r: { errors: { message: string }[] }) => r.errors.map((e) => e.message);

/** A repo with two story maps, HT and CHK, and no planning/. */
function twoMaps(): string {
  const root = fresh();
  init(root, { name: "Hello Todo", key: "HT" });
  init(root, { name: "Checkout", key: "CHK" });
  return root;
}

describe("a repo with several story maps", () => {
  it("state set by story id writes the move and returns 0, rather than crashing after it", () => {
    expect(runState(["set", "HT-1", "in_progress", "--dir", twoMaps()])).toBe(0);
  });

  it("release check says to pass --map, rather than that there is no such release", () => {
    expect(() => checkRelease({ number: 1 }, twoMaps())).toThrow(/several story maps.*pass --map/);
  });
});

describe("decide in a repo with decisions.md and no story map", () => {
  it("writes the decision and returns 0", () => {
    const root = fresh();
    write(join(root, "decisions.md"), "# Decisions\n");
    expect(runDecide(["Pick Stripe", "--why", "cheap", "--dir", root])).toBe(0);
  });
});

describe("story ids after a plan key is added", () => {
  it("a story added to a bare-id map keeps the bare prefix, and the map validates", () => {
    const root = fresh();
    init(root, { name: "Hello Todo", key: "HT" });
    const added = newStory({ title: "Second", activity: "getting-started" }, join(root, "maps/ht"));
    expect(added.id).toBe("HT-2");
    expect(messages(validate(root))).toEqual([]);
  });

  it("init refuses a repo whose plan is the old kind, and writes no story map", () => {
    const root = fresh();
    write(join(root, "planning/plan.yaml"), "name: Hello\nkey: PAY\nperiod: Q1 2027\nlevel: group\npillars: []\n");
    expect(() => init(root, { name: "Hello Todo", key: "HT" })).toThrow("This repo has planning/plan.yaml, a plan of the old kind.");
    expect(existsSync(join(root, "maps/ht"))).toBe(false);
  });
});

describe("0.2 layouts inside a map", () => {
  it("an approvals.yaml in a map is an error that names the file, not silently dropped", () => {
    const root = fresh();
    init(root, { name: "Hello Todo", key: "HT" });
    write(join(root, "maps/ht/approvals.yaml"), "approvals: {}\n");
    expect(messages(validate(root)).some((m) => m.includes("approvals file, which nikOS no longer reads"))).toBe(true);
  });

  it("a state/ folder in a map is an error that names the folder, not silently dropped", () => {
    const root = fresh();
    init(root, { name: "Hello Todo", key: "HT" });
    mkdirSync(join(root, "maps/ht/state"));
    write(join(root, "maps/ht/state/HT-1.yaml"), "status: done\n");
    expect(messages(validate(root)).some((m) => m.includes("per-story state layout"))).toBe(true);
  });
});

describe("the drift message when a map drops its owner", () => {
  it("says 'none', not 'undefined'", () => {
    // A solo repo: no group key, so the owner is the only prefix and dropping it leaves none.
    const root = fresh();
    init(root, { name: "Hello Todo", key: "HT" });
    const p = join(root, "maps/ht/storymap.yaml");
    write(p, readFileSync(p, "utf8").replace("key: HT\n", "key: HT\nowner: WEB\n"));
    writeMapSummary(root, join(root, "maps/ht"));
    write(p, readFileSync(p, "utf8").replace("owner: WEB\n", ""));
    const text = messages(validate(root)).join("\n");
    expect(text).toContain("owner is 'WEB' in delivery.yaml, but 'none' now");
    expect(text).not.toContain("undefined");
  });
});

describe("set-up in a 0.2.x repo", () => {
  it("refuses an intent/ repo before asking anything", async () => {
    const root = fresh();
    mkdirSync(join(root, "intent"));
    await expect(askOnboarding(root, (async () => "") as any, fresh())).rejects.toThrow(/by hand/);
  });
});
