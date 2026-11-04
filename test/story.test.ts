import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { newStory } from "../src/commands/story";
import { copyExample } from "./helpers";

const snapshot = (dir: string) => ["storymap.yaml", "state.yaml"].map((f) => readFileSync(join(dir, f), "utf8"));

describe("story add", () => {
  it("adds the next story to the map, state and a starter feature, and still validates", () => {
    const dir = copyExample();
    const r = newStory({ title: "Mark a task done", activity: "tasks" }, dir);
    expect(r).toMatchObject({ id: "HT-4", release: 2, feature: join(dir, "features/tasks/mark-a-task-done.feature") });
    expect(r.validation.errors).toEqual([]);

    const map = parse(readFileSync(join(dir, "storymap.yaml"), "utf8"));
    expect(map.releases[1].stories).toEqual(["HT-3", "HT-4"]);
    expect(readFileSync(join(dir, "storymap.yaml"), "utf8")).toContain("stories: [HT-3, HT-4]");
    expect(parse(readFileSync(join(dir, "state.yaml"), "utf8")).stories["HT-4"]).toEqual({ status: "todo" });
    expect(readFileSync(r.feature, "utf8")).toMatch(/^@HT-4 @release-2 @must @activity-tasks\nFeature: Mark a task done\n/);

    // A chosen release and priority, numbered after the last story.
    const next = newStory({ title: "Undo a delete", activity: "tasks", release: 1, priority: "could" }, dir);
    expect(next).toMatchObject({ id: "HT-5", release: 1 });
    expect(next.validation.errors).toEqual([]);
  });

  it("refuses an unknown activity and names the existing ones", () => {
    const dir = copyExample();
    const before = snapshot(dir);
    expect(() => newStory({ title: "Share a list", activity: "sharing" }, dir)).toThrow("'sharing' is not an activity in storymap.yaml. Activities: tasks");
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(join(dir, "features/sharing"))).toBe(false);
  });

  it("refuses a title whose feature file exists, or a release that doesn't", () => {
    const dir = copyExample();
    const before = snapshot(dir);
    expect(() => newStory({ title: "Add a task", activity: "tasks" }, dir)).toThrow("already exists");
    expect(() => newStory({ title: "New", activity: "tasks", release: 9 }, dir)).toThrow("There is no release 9. Releases: 1, 2");
    expect(snapshot(dir)).toEqual(before);
  });
});
