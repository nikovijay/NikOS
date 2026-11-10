import { describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { init } from "../src/commands/init";
import { setupVerify } from "../src/commands/verify";
import { setState, stepTrouble } from "../src/commands/state";
import { approve, runApprove } from "../src/commands/approve";
import { next } from "../src/commands/next";
import { checkRelease } from "../src/commands/release";
import { validate } from "../src/commands/validate";
import { renderMap, storyMapOf } from "../src/commands/map";
import { show } from "../src/commands/show";
import { specHash } from "../src/lib/project";
import { copyExample, edit, rootOf } from "./helpers";

const stateOf = (intent: string, id: string) => parse(readFileSync(join(intent, "state.yaml"), "utf8")).stories[id];
const feature = (intent: string, file: string) => join(intent, "features/tasks", file);
const warnings = (intent: string) => validate(intent).warnings.map((w) => w.message);
const errors = (intent: string) => validate(intent).errors.map((e) => e.message);

describe("cancel", () => {
  it("needs a reason, keeps the story, and can be undone", () => {
    const intent = copyExample();
    expect(() => setState("HT-3", "cancelled", { dir: intent })).toThrow('Say why HT-3 is cancelled: --reason "<why>"');
    setState("HT-3", "cancelled", { dir: intent, reason: "Drag and drop covers it" });
    expect(stateOf(intent, "HT-3")).toMatchObject({ status: "cancelled", cancelled_reason: "Drag and drop covers it" });
    expect(validate(intent).errors).toEqual([]);
    expect(renderMap(intent)).toContain('class="card cancelled"');
    expect(show("HT-3", intent)).toContain("Cancelled: Drag and drop covers it");
    setState("HT-3", "todo", { dir: intent });
    expect(stateOf(intent, "HT-3").cancelled_reason).toBeUndefined();
  });

  it("is skipped by next and doesn't hold back a release's Shipped stamp", () => {
    const intent = copyExample();
    edit(join(intent, "state.yaml"), (s) => s.replace("status: in_progress", "status: done"));
    setState("HT-3", "cancelled", { dir: intent, reason: "Not needed" });
    expect(next(intent).story).toBeUndefined();
    const html = renderMap(intent);
    expect(html.slice(html.indexOf('id="release-2"'))).not.toContain("Shipped");
    expect(html.slice(html.indexOf('id="release-2"'))).toContain("0 of 0 done");
  });
});

describe("approve", () => {
  it("isn't a status, and refuses a story that isn't done", () => {
    const intent = copyExample();
    expect(() => setState("HT-1", "approved" as any, { dir: intent })).toThrow("Approval isn't a status: a person approves HT-1 with nikos approve");
    expect(() => approve("HT-3", { dir: intent, by: "Niko" })).toThrow("HT-3 is todo: only a done story can be approved");
  });

  it("refuses when the feature changed after done", () => {
    const intent = copyExample();
    edit(join(intent, "state.yaml"), (s) => s.replace("plan_version: 2", "plan_version: 2\n    spec_hash: abcdefabcdef"));
    expect(() => approve("HT-1", { dir: intent, by: "Niko" })).toThrow("HT-1's feature changed after it was done");
  });

  it("only runs in an interactive terminal", async () => {
    // Tests, like coding agents, run without one.
    expect(await runApprove(["HT-1", "--dir", copyExample()])).toBe(1);
  });

  it("records a sign-off in approvals/<ID>.yaml that lapses when the feature changes or the story is redone", async () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-approve-"));
    init(root, { name: "Fixture", key: "FX" });
    writeFileSync(join(root, "package.json"), '{"name":"fx","private":true}');
    symlinkSync(join(__dirname, "../node_modules"), join(root, "node_modules"));
    setupVerify(root);
    writeFileSync(
      join(root, "test/steps/first-story.steps.mjs"),
      `import { Given, When, Then } from "@cucumber/cucumber";\nGiven("I am a new user", () => {});\nWhen("I do the one thing this product is for", () => {});\nThen("I see the result I came for", () => {});\n`,
    );
    const intent = join(root, "maps", "fx");
    const approvals = () => parse(readFileSync(join(intent, "approvals", "FX-1.yaml"), "utf8"));
    setState("FX-1", "in_progress", { dir: root });
    setState("FX-1", "done", { dir: root, now: "2026-11-06T10:00:00Z" });
    const file = join(intent, "features/getting-started/first-story.feature");
    const hash = specHash(readFileSync(file, "utf8"));
    expect(stateOf(intent, "FX-1")).toMatchObject({ status: "done", spec_hash: hash, done_at: "2026-11-06T10:00:00Z" });

    expect(approve("FX-1", { dir: root, by: "Niko", date: "2026-11-06" })).toEqual({ story: "FX-1", by: "Niko", on: "2026-11-06" });
    expect(approvals()).toEqual({ by: "Niko", on: "2026-11-06", via: "terminal", spec_hash: hash, done_at: "2026-11-06T10:00:00Z" });
    expect(stateOf(intent, "FX-1").status).toBe("done"); // state.yaml doesn't change
    expect(validate(root).errors).toEqual([]);
    expect(validate(root).warnings).toEqual([]);
    expect(storyMapOf(root).releases[0].stories[0]).toMatchObject({ status: "approved", approvedBy: "Niko", specChanged: false });
    expect(show("FX-1", root)).toContain("Approved by Niko on 2026-11-06");
    expect(() => approve("FX-1", { dir: root, by: "Niko" })).toThrow("FX-1 is already approved (by Niko on 2026-11-06)");

    edit(file, (s) => s.replace("Feature:", "@persona-new-user\nFeature:"));
    expect(validate(root).warnings).toEqual([]); // tags above Feature: aren't the spec
    edit(file, (s) => s.replace(/Scenario: (.*)/, "Scenario: $1 quickly"));
    expect(validate(root).warnings.map((w) => w.message)).toEqual([
      "FX-1 changed after it was done",
      "FX-1's approval no longer holds: its feature changed since",
    ]);
    expect(renderMap(root)).toContain('class="card changed"');

    // Redone with the same feature: the old approval was for the earlier done.
    edit(file, (s) => s.replace(" quickly", ""));
    setState("FX-1", "needs_rework", { dir: root });
    expect(validate(root).warnings.map((w) => w.message)).toEqual(["FX-1's approval no longer holds: it's needs_rework now"]);
    setState("FX-1", "in_progress", { dir: root });
    setState("FX-1", "done", { dir: root, now: "2026-11-07T09:00:00Z" });
    expect(validate(root).warnings.map((w) => w.message)).toEqual(["FX-1's approval no longer holds: it went through done again since"]);
    expect(storyMapOf(root).releases[0].stories[0].status).toBe("done");
    // The person answered "Approve" in chat: runApprove records it without a terminal.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runApprove(["FX-1", "--via", "chat", "--dir", root])).toBe(0);
    log.mockRestore();
    expect(approvals()).toMatchObject({ via: "chat", done_at: "2026-11-07T09:00:00Z" });
    expect(validate(root).warnings).toEqual([]);
  }, 60_000);

  it("validate checks approvals/ names real stories", () => {
    const intent = copyExample();
    mkdirSync(join(intent, "approvals"));
    writeFileSync(join(intent, "approvals", "HT-9.yaml"), "by: Niko\non: 2026-11-06\nspec_hash: abcdefabcdef\ndone_at: x\n");
    expect(errors(intent)).toEqual(["HT-9 is an unknown story id"]);
  });
});

describe("spec changed after done", () => {
  it("warns, and the map marks it", () => {
    const intent = copyExample();
    const file = feature(intent, "add-a-task.feature");
    edit(join(intent, "state.yaml"), (s) => s.replace("plan_version: 2", `plan_version: 2\n    spec_hash: ${specHash(readFileSync(file, "utf8"))}`));
    expect(warnings(intent)).toEqual([]);
    edit(file, (s) => s.replace("Feature: Add a task", "Feature: Add a task fast"));
    expect(warnings(intent)).toEqual(["HT-1 changed after it was done"]);
    const html = renderMap(intent);
    expect(html).toContain("1 spec changed");
    expect(show("HT-1", intent)).toContain("! The feature changed after it was done");
  });
});

describe("dependencies", () => {
  const depend = (intent: string, file: string, ...ids: string[]) =>
    edit(feature(intent, file), (s) => s.replace(/^(@HT-\d+[^\n]*)/, `$1 ${ids.map((i) => `@depends-${i}`).join(" ")}`));

  it("next waits for a story's dependencies to be done", () => {
    const intent = copyExample();
    edit(join(intent, "state.yaml"), (s) => s.replace("status: in_progress", "status: todo").replace("queue: [HT-2, HT-3]", "queue: [HT-3, HT-2]"));
    depend(intent, "reorder-tasks.feature", "HT-2");
    expect(next(intent)).toMatchObject({ story: "HT-2", waiting: [{ id: "HT-3", on: ["HT-2"] }] });
    depend(intent, "see-todays-top-three.feature", "HT-1");
    expect(next(intent).story).toBe("HT-2"); // HT-1 is done
    const card = renderMap(intent).match(/<a class="card[^"]*" data-story="HT-3"[\s\S]*?<\/a>/)![0];
    expect(card).toContain("Waits on HT-2");
  });

  it("validate catches unknown ids, loops and a dependency in a later release", () => {
    const intent = copyExample();
    depend(intent, "add-a-task.feature", "HT-3", "HT-9");
    depend(intent, "reorder-tasks.feature", "HT-2");
    depend(intent, "see-todays-top-three.feature", "HT-1");
    expect(errors(intent)).toEqual([
      "@depends-HT-9 names a story that doesn't exist",
      "stories depend on each other in a loop: HT-1 → HT-3 → HT-2 → HT-1",
    ]);
    expect(warnings(intent)).toContain("HT-1 in release 1 depends on HT-3, which is in a later release (2)");
  });
});

describe("personas and story types", () => {
  it("checks persona tags against the map and shows both on the card and panel", () => {
    const intent = copyExample();
    edit(join(intent, "storymap.yaml"), (s) => s.replace("activities:", "personas:\n  - id: planner\n    title: Weekly planner\nactivities:"));
    edit(feature(intent, "reorder-tasks.feature"), (s) => s.replace("@HT-3", "@HT-3 @persona-planner @persona-ghost @type-technical"));
    expect(errors(intent)).toEqual(["@persona-ghost is not a persona in storymap.yaml"]);
    expect(validate(intent).warnings).toEqual([]);
    const html = renderMap(intent);
    expect(html).toContain('data-type="technical" data-personas="planner ghost"');
    expect(html).toContain('<span class="stype">Technical</span>');
    expect(html).toContain("<li>For Weekly planner, ghost</li>");
  });
});

describe("release check and approvals", () => {
  const signed = (intent: string) => {
    const hash = specHash(readFileSync(feature(intent, "add-a-task.feature"), "utf8"));
    mkdirSync(join(intent, "approvals"), { recursive: true });
    writeFileSync(join(intent, "approvals", "HT-1.yaml"), `by: Niko\non: 2026-11-06\nvia: chat\nspec_hash: "${hash}"\ndone_at: 2026-11-03\n`);
  };

  it("says when a changed feature means an approval no longer holds", () => {
    const intent = copyExample();
    signed(intent);
    expect(checkRelease({ number: 1 }, intent).gaps).not.toContain("HT-1's feature changed after it was done");
    edit(feature(intent, "add-a-task.feature"), (s) => s.replace(/Scenario: (.*)/, "Scenario: $1 quickly"));
    edit(join(intent, "state.yaml"), (s) => s.replace("plan_version: 2", `plan_version: 2\n    spec_hash: ${"abcdef123456"}`));
    expect(checkRelease({ number: 1 }, intent).gaps).toContain("HT-1's feature changed after it was done, so Niko's approval no longer holds");
  });

  it("says why a story isn't approved when approvals are required and it went through done again", () => {
    const intent = copyExample();
    signed(intent);
    writeFileSync(join(rootOf(intent), "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\n");
    expect(checkRelease({ number: 1 }, intent).gaps).not.toContain("HT-1 isn't approved");
    edit(join(intent, "state.yaml"), (s) => s.replace("plan_version: 2", "plan_version: 2\n    done_at: 2026-11-07T09:00:00Z"));
    expect(checkRelease({ number: 1 }, intent).gaps).toContain("HT-1 isn't approved: it went through done again since Niko approved it");
    // With approvals optional, a lapsed approval doesn't hold the release back.
    writeFileSync(join(rootOf(intent), "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: optional\n");
    expect(checkRelease({ number: 1 }, intent).gaps.filter((g) => g.startsWith("HT-1"))).toEqual([]);
  });
});

describe("step trouble", () => {
  it("names pending and undefined steps from the runner's tally", () => {
    expect(stepTrouble("1 scenario (1 pending)\n3 steps (1 pending, 2 skipped)\n")).toEqual(['1 step still returns "pending": replace it with a real check in the step definitions']);
    expect(stepTrouble("1 scenario (1 undefined)\n3 steps (2 undefined, 1 passed)\n")).toEqual([
      "2 steps have no step definition yet: add them to the step definitions (the runner's output has a snippet to start from)",
    ]);
    expect(stepTrouble("0 features passed, 1 failed\n1 scenario passed\n0 steps passed, 0 failed, 1 skipped, 2 undefined\n")[0]).toMatch(/^2 steps have no step definition yet/);
    expect(stepTrouble("1 scenario (1 failed)\n3 steps (1 failed, 2 passed)\n")).toEqual([]);
  });
});
