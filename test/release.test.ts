import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { addRelease, moveStory, removeRelease, renameRelease, reorderRelease } from "../src/commands/release";
import { newStep } from "../src/commands/step";
import { newStory } from "../src/commands/story";
import { validate } from "../src/commands/validate";
import { renderMap } from "../src/commands/map";
import { copyExample } from "./helpers";

const mapOf = (dir: string) => parse(readFileSync(join(dir, "storymap.yaml"), "utf8"));
const tagLine = (dir: string, file: string) => readFileSync(join(dir, "features/tasks", file), "utf8").split("\n")[0];

describe("release commands", () => {
  it("adds the next release with a goal, and renames it or clears the goal", () => {
    const dir = copyExample();
    const r = addRelease({ title: "Sharing", goal: "Share a list with one other person." }, dir);
    expect(r.number).toBe(3);
    expect(r.validation.errors).toEqual([]);
    expect(mapOf(dir).releases[2]).toEqual({ number: 3, title: "Sharing", goal: "Share a list with one other person.", stories: [] });
    expect(readFileSync(join(dir, "storymap.yaml"), "utf8")).toContain("stories: []");

    renameRelease({ number: 2, title: "Polish", goal: "Make the list feel tidy." }, dir);
    expect(mapOf(dir).releases[1]).toMatchObject({ number: 2, title: "Polish", goal: "Make the list feel tidy." });
    expect(Object.keys(mapOf(dir).releases[1])).toEqual(["number", "title", "goal", "stories"]);
    renameRelease({ number: 2, goal: "" }, dir);
    expect(mapOf(dir).releases[1].goal).toBeUndefined();
    expect(() => renameRelease({ number: 9, title: "Nope" }, dir)).toThrow("There is no release 9. Releases: 1, 2, 3");
  });

  it("moves a story and retags its feature, so validate stays clean", () => {
    const dir = copyExample();
    const r = moveStory({ id: "HT-2", to: 2 }, dir);
    expect(r).toMatchObject({ from: 1, to: 2 });
    expect(r.validation.errors).toEqual([]);
    expect(r.validation.warnings).toEqual([]);
    expect(mapOf(dir).releases.map((x: any) => x.stories)).toEqual([["HT-1"], ["HT-3", "HT-2"]]);
    expect(tagLine(dir, "see-todays-top-three.feature")).toBe("@HT-2 @release-2 @must @activity-tasks @step-focus @effort-M");
    expect(() => moveStory({ id: "HT-2", to: 2 }, dir)).toThrow("already in release 2");
    expect(() => moveStory({ id: "HT-99", to: 1 }, dir)).toThrow("HT-99 is not in any release");
  });

  it("reorders releases, renumbers them from 1 and retags every moved story", () => {
    const dir = copyExample();
    const r = reorderRelease({ number: 2, to: 1 }, dir);
    expect(r.order).toEqual([{ number: 1, title: "Enhancements" }, { number: 2, title: "MVP" }]);
    expect(r.validation.errors).toEqual([]);
    expect(r.validation.warnings).toEqual([]);
    expect(mapOf(dir).releases[1]).toMatchObject({ number: 2, title: "MVP", bets: ["fewer-missed-tasks"], stories: ["HT-1", "HT-2"] });
    expect(tagLine(dir, "reorder-tasks.feature")).toMatch(/^@HT-3 @release-1 /);
    expect(tagLine(dir, "add-a-task.feature")).toMatch(/^@HT-1 @release-2 /);
    expect(() => reorderRelease({ number: 1, to: 5 }, dir)).toThrow("Position must be from 1 to 2");
  });

  it("refuses a release title that is already taken, ignoring case", () => {
    const dir = copyExample();
    addRelease({ title: "Beta" }, dir);
    expect(() => addRelease({ title: " beta " }, dir)).toThrow("Release 3 is already called 'Beta'");
    expect(() => renameRelease({ number: 2, title: "MVP" }, dir)).toThrow("Release 1 is already called 'MVP'");
    renameRelease({ number: 3, title: "BETA" }, dir);
    expect(mapOf(dir).releases.map((r: any) => r.title)).toEqual(["MVP", "Enhancements", "BETA"]);
  });

  it("removes only an empty release, renumbering and retagging the ones after it", () => {
    const dir = copyExample();
    addRelease({ title: "Beta" }, dir);
    moveStory({ id: "HT-3", to: 3 }, dir);
    expect(() => removeRelease({ number: 3 }, dir)).toThrow("Release 3 still has HT-3");
    expect(() => removeRelease({ number: 1 }, dir)).toThrow("Release 1 still has HT-1, HT-2");
    const r = removeRelease({ number: 2 }, dir);
    expect(r).toMatchObject({ number: 2, title: "Enhancements" });
    expect(r.validation.errors).toEqual([]);
    expect(r.validation.warnings).toEqual([]);
    expect(mapOf(dir).releases.map((x: any) => [x.number, x.title])).toEqual([[1, "MVP"], [2, "Beta"]]);
    expect(tagLine(dir, "reorder-tasks.feature")).toMatch(/^@HT-3 @release-2 /);
    expect(() => removeRelease({ number: 9 }, dir)).toThrow("There is no release 9");
  });

  it("won't remove a release that still delivers bets", () => {
    const dir = copyExample();
    moveStory({ id: "HT-1", to: 2 }, dir);
    moveStory({ id: "HT-2", to: 2 }, dir);
    expect(() => removeRelease({ number: 1 }, dir)).toThrow("Release 1 delivers bets (fewer-missed-tasks)");
  });

  it("warns when a feature's release tag disagrees with storymap.yaml", () => {
    const dir = copyExample();
    const file = join(dir, "features/tasks/reorder-tasks.feature");
    writeFileSync(file, readFileSync(file, "utf8").replace("@release-2", "@release-1"));
    const v = validate(dir);
    expect(v.errors).toEqual([]);
    expect(v.warnings.map((w) => w.message)).toEqual(["is tagged @release-1 but storymap.yaml puts HT-3 in release 2"]);
  });
});

describe("steps", () => {
  it("adds a step under an activity and a story to it", () => {
    const dir = copyExample();
    expect(newStep({ title: "Share a list", activity: "tasks" }, dir)).toMatchObject({ id: "share-a-list", validation: { errors: [] } });
    expect(mapOf(dir).activities[0].steps.map((s: any) => s.id)).toEqual(["capture", "focus", "organise", "share-a-list"]);
    expect(() => newStep({ title: "Capture", activity: "tasks", id: "capture" }, dir)).toThrow("already a step 'capture'");
    expect(() => newStep({ title: "X", activity: "nope" }, dir)).toThrow("'nope' is not an activity");

    const s = newStory({ title: "Send a list link", activity: "tasks", step: "share-a-list" }, dir);
    expect(readFileSync(s.feature, "utf8").split("\n")[0]).toBe("@HT-4 @release-2 @must @activity-tasks @step-share-a-list");
    expect(s.validation.errors).toEqual([]);
    expect(() => newStory({ title: "Elsewhere", activity: "tasks", step: "nope" }, dir)).toThrow("'nope' is not a step of activity 'tasks'");
  });

  it("refuses a step tag that isn't on the map, or a repeated step id", () => {
    const dir = copyExample();
    const file = join(dir, "features/tasks/reorder-tasks.feature");
    writeFileSync(file, readFileSync(file, "utf8").replace("@step-organise", "@step-sharing"));
    expect(validate(dir).errors.map((e) => e.message)).toEqual(["@step-sharing is not a step in storymap.yaml"]);
    const map = join(dir, "storymap.yaml");
    writeFileSync(map, readFileSync(map, "utf8").replace("id: organise", "id: focus"));
    expect(validate(dir).errors.map((e) => e.message)).toContain("step 'focus' appears more than once");
  });

  it("the map shows a step row, puts each story under its step, and shows release goals", () => {
    const html = renderMap(copyExample());
    expect(html).toContain('<div class="activity" style="--span:3">');
    expect(html.match(/<div class="step">[^<]+<\/div>/g)).toEqual([
      '<div class="step">Capture a task</div>',
      '<div class="step">Focus on today</div>',
      '<div class="step">Organise the list</div>',
    ]);
    const release1 = html.slice(html.indexOf('id="release-1"'), html.indexOf('id="release-2"'));
    expect(release1).toContain("<p class=\"goal\">Capture tasks and see only today&#39;s top three.</p>");
    const cells = release1.match(/<div class="cell"[^>]*>.*?<\/div>(?=<div class="cell"|<\/div><\/section>)/g) ?? [];
    expect(cells.map((c) => /data-story="([^"]+)"/.exec(c)?.[1] ?? "")).toEqual(["HT-1", "HT-2", ""]);
  });
});
