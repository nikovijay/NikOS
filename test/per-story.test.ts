import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { parse } from "yaml";
import { init } from "../src/commands/init";
import { setupVerify } from "../src/commands/verify";
import { setState } from "../src/commands/state";
import { approve } from "../src/commands/approve";
import { next } from "../src/commands/next";
import { newStory } from "../src/commands/story";
import { validate } from "../src/commands/validate";
import { storyMapOf } from "../src/commands/map";
import { migrate } from "../src/commands/migrate";
import { linkTicket } from "../src/commands/tracker";
import { MemoryStore, withStore } from "../src/lib/store";
import { walk } from "../src/lib/project";
import { copyExample, edit } from "./helpers";

const yamlAt = (p: string) => parse(readFileSync(p, "utf8"));

describe("per-story files", () => {
  it("moves every story to its own file and back, with the same story map", () => {
    const intent = copyExample();
    const before = storyMapOf(intent);
    expect(migrate(intent, "per-story")).toEqual({ layout: "per-story", states: 3, approvals: 0 });
    expect(yamlAt(join(intent, "state.yaml"))).toEqual({ format_version: 1, stories: {}, run: { queue: ["HT-2", "HT-3"] } });
    expect(readFileSync(join(intent, "state.yaml"), "utf8")).toContain("Each story's state is in intent/state/<ID>.yaml");
    expect(yamlAt(join(intent, "state/HT-2.yaml"))).toEqual({ status: "in_progress", claimed_by: "claude-code", plan_version: 1, blockers: [], updated: "2026-11-03" });
    expect(storyMapOf(intent)).toEqual(before);
    expect(next(intent).open).toEqual([{ id: "HT-2", status: "in_progress" }]);
    expect(validate(intent).errors).toEqual([]);

    // Writes land in the story's own file; state.yaml stays put.
    const stateText = readFileSync(join(intent, "state.yaml"), "utf8");
    setState("HT-3", "cancelled", { dir: intent, reason: "Not needed", date: "2026-11-06" });
    linkTicket({ id: "HT-2", ticket: "PAY-7" }, intent);
    const added = newStory({ title: "Share a list", activity: "tasks" }, intent);
    expect(yamlAt(join(intent, "state/HT-3.yaml"))).toMatchObject({ status: "cancelled", cancelled_reason: "Not needed", updated: "2026-11-06" });
    expect(yamlAt(join(intent, "state/HT-2.yaml")).ticket).toBe("PAY-7");
    expect(yamlAt(join(intent, `state/${added.id}.yaml`))).toEqual({ status: "todo" });
    expect(readFileSync(join(intent, "state.yaml"), "utf8")).toBe(stateText);
    expect(validate(intent).errors).toEqual([]);

    expect(migrate(intent, "single-file")).toEqual({ layout: "single-file", states: 4, approvals: 0 });
    expect(existsSync(join(intent, "state/HT-2.yaml"))).toBe(false);
    expect(yamlAt(join(intent, "state.yaml")).stories["HT-3"]).toMatchObject({ status: "cancelled" });
    expect(readFileSync(join(intent, "state.yaml"), "utf8")).not.toContain("intent/state/<ID>.yaml");
    expect(validate(intent).errors).toEqual([]);
  });

  it("catches a story kept in both places, a missing file and a bad entry", () => {
    const intent = copyExample();
    migrate(intent, "per-story");
    writeFileSync(join(intent, "state/HT-9.yaml"), "status: todo\n");
    writeFileSync(join(intent, "state/HT-1.yaml"), "status: shipped\n");
    edit(join(intent, "state.yaml"), (s) => s.replace("stories: {}", "stories:\n  HT-2: { status: todo }"));
    writeFileSync(join(intent, "state/notes.yaml"), "status: todo\n");
    expect(validate(intent).errors.map((e) => `${e.file}: ${e.message}`)).toEqual([
      "state/HT-1.yaml: HT-1.status 'shipped' is not one of todo, in_progress, needs_rework, done, cancelled",
      "state/HT-2.yaml: HT-2 is also in state.yaml",
      "state/notes.yaml: 'notes' is not a story id",
      "state/HT-9.yaml: HT-9 is an unknown story id",
    ]);
  });

  it("refuses to move a repo with problems, so nothing is lost", () => {
    const intent = copyExample();
    edit(join(intent, "state.yaml"), (s) => s.replace("status: todo", "status: shipped"));
    expect(() => migrate(intent, "per-story")).toThrow("Fix intent/ first");
    expect(existsSync(join(intent, "state"))).toBe(false);
  });

  it("works in memory, and lists the files it deleted", () => {
    const intent = copyExample();
    const root = dirname(intent);
    const files = Object.fromEntries(walk(root).map((f) => [relative(root, f), readFileSync(f, "utf8")]));
    const mem = new MemoryStore(files);
    const r = withStore(mem, () => migrate(join(mem.root, "intent"), "per-story"));
    expect(r.states).toBe(3);
    expect(mem.changes().map((c) => c.path)).toEqual(["intent/state.yaml", "intent/state/HT-1.yaml", "intent/state/HT-2.yaml", "intent/state/HT-3.yaml"]);
    withStore(mem, () => migrate(join(mem.root, "intent"), "single-file"));
    expect(mem.deletions()).toEqual(["intent/state/HT-1.yaml", "intent/state/HT-2.yaml", "intent/state/HT-3.yaml"]);
    expect(existsSync(join(intent, "state"))).toBe(false); // the disk was never touched
  });

  it("keeps each approval in its own file, and carries the CODEOWNERS rule over", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-perstory-"));
    init(root, { name: "Fixture", key: "FX" });
    writeFileSync(join(root, "package.json"), '{"name":"fx","private":true}');
    symlinkSync(join(__dirname, "../node_modules"), join(root, "node_modules"));
    setupVerify(root);
    writeFileSync(
      join(root, "test/steps/first-story.steps.mjs"),
      `import { Given, When, Then } from "@cucumber/cucumber";\nGiven("I am a new user", () => {});\nWhen("I do the one thing this product is for", () => {});\nThen("I see the result I came for", () => {});\n`,
    );
    const intent = join(root, "intent");
    mkdirSync(join(root, ".github"));
    writeFileSync(join(root, ".github/CODEOWNERS"), "/intent/approvals.yaml @acme/product\n");
    setState("FX-1", "in_progress", { dir: root });
    setState("FX-1", "done", { dir: root, now: "2026-11-06T10:00:00Z" });
    approve("FX-1", { dir: root, by: "Niko", date: "2026-11-06" });

    expect(migrate(root, "per-story")).toEqual({ layout: "per-story", states: 1, approvals: 1, codeowners: join(root, ".github/CODEOWNERS") });
    expect(existsSync(join(intent, "approvals.yaml"))).toBe(false);
    expect(yamlAt(join(intent, "approvals/FX-1.yaml"))).toMatchObject({ by: "Niko", on: "2026-11-06", via: "terminal" });
    expect(readFileSync(join(root, ".github/CODEOWNERS"), "utf8")).toBe("/intent/approvals.yaml @acme/product\n/intent/approvals/ @acme/product\n");
    expect(storyMapOf(root).releases[0].stories[0]).toMatchObject({ status: "approved", approvedBy: "Niko" });
    expect(validate(root).errors).toEqual([]);
    expect(validate(root).warnings).toEqual([]);

    // Redone, the approval lapses; a new one lands in the story's file, not approvals.yaml.
    setState("FX-1", "needs_rework", { dir: root });
    setState("FX-1", "in_progress", { dir: root });
    setState("FX-1", "done", { dir: root, now: "2026-11-07T10:00:00Z" });
    expect(validate(root).warnings.map((w) => `${w.file}: ${w.message}`)).toEqual(["approvals/FX-1.yaml: FX-1's approval no longer holds: it went through done again since"]);
    approve("FX-1", { dir: root, by: "Ana", date: "2026-11-07" });
    expect(yamlAt(join(intent, "approvals/FX-1.yaml"))).toMatchObject({ by: "Ana", done_at: "2026-11-07T10:00:00Z" });
    expect(existsSync(join(intent, "approvals.yaml"))).toBe(false);

    expect(migrate(root, "single-file")).toMatchObject({ states: 1, approvals: 1 });
    expect(yamlAt(join(intent, "approvals.yaml")).approvals["FX-1"]).toMatchObject({ by: "Ana" });
    expect(existsSync(join(intent, "approvals/FX-1.yaml"))).toBe(false);
  }, 60000);
});
