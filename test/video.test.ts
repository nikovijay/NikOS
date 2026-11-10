import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { briefOf, storyboard, writeVideo } from "../src/commands/video";
import { copyExample, edit, rootOf } from "./helpers";

// hello-todo: HT-1 (done) and HT-2 (in progress) in "tasks", HT-3 (todo).

describe("nikos video", () => {
  it("drafts the brief from the constitution and only the stories marked done", () => {
    const sb = storyboard(copyExample());
    expect(sb.product).toEqual({ name: "Hello Todo", idea: "A todo list that only shows today's three most important tasks." });
    expect(sb.users).toBe("Busy people who keep long todo lists and still miss the important things.");
    expect(sb.beats.flatMap((b) => b.stories.map((s) => s.id))).toEqual(["HT-1"]);
    expect(sb.beats[0].stories[0]).toEqual({ id: "HT-1", title: "Add a task", outcomes: ["Adding a task shows it at the top", "Blank tasks are ignored"] });
    expect(sb.notBuilt.map((s) => s.id)).toEqual(["HT-2", "HT-3"]);

    const brief = briefOf(sb);
    expect(brief).toContain("- **Product:** Hello Todo. A todo list that only shows today's three most important tasks.");
    expect(brief).toContain("| 01 Manage tasks | HT-1 Add a task |");
    expect(brief).toContain("- **Out:** anything not built yet: HT-2 See today's top three; HT-3 Reorder tasks.");
    expect(brief).not.toMatch(/\| [^|]*HT-[23]/); // never in a beat
  });

  it("reads the constitution from the repo root, and says so when it is missing", () => {
    const dir = copyExample();
    rmSync(join(rootOf(dir), "constitution.md"));
    expect(() => storyboard(dir)).toThrow("No constitution.md");
  });

  it("refuses when nothing is done, so a video never shows unbuilt work", () => {
    const dir = copyExample();
    edit(join(dir, "state.yaml"), (s) => s.replace("status: done", "status: in_progress"));
    expect(() => storyboard(dir)).toThrow("No story is done yet");
  });

  it("gives one timed beat per activity with done stories, in story map order", () => {
    const dir = copyExample();
    edit(join(dir, "storymap.yaml"), (s) => s.replace("activities:\n", "activities:\n  - id: lists\n    title: Share lists\n").replace("  - id: tasks\n    title: Manage tasks\n", "  - id: tasks\n    title: Manage tasks\n  - id: focus\n    title: Focus on today\n"));
    edit(join(dir, "features/tasks/see-todays-top-three.feature"), (s) => s.replace("@activity-tasks", "@activity-focus"));
    edit(join(dir, "state.yaml"), (s) => s.replace(/HT-2:\n    status: in_progress/, "HT-2:\n    status: done"));
    const sb = storyboard(dir);
    // "lists" has no stories and is left out; tasks then focus, as in the map.
    expect(sb.beats.map((b) => b.activity)).toEqual(["Manage tasks", "Focus on today"]);
    expect(sb.beats[0].from).toBe(sb.intro[1]);
    expect(sb.beats[1].from).toBe(sb.beats[0].to);
    expect(sb.close[0]).toBe(sb.beats[1].to);
    expect(sb.total).toBe(Math.ceil(sb.close[1]));
  });

  it("writes brief.md and the storyboard.js the pack's template reads", () => {
    const out = mkdtempSync(join(tmpdir(), "nikos-video-"));
    writeVideo(copyExample(), out);
    expect(readFileSync(join(out, "brief.md"), "utf8")).toMatch(/^# Brief: Hello Todo\n/);
    const js = readFileSync(join(out, "storyboard.js"), "utf8");
    const sb = JSON.parse(/window\.STORYBOARD = ([\s\S]*);\n$/.exec(js)![1]);
    expect(sb.beats).toHaveLength(1);

    // The template loads storyboard.js and builds one section per beat from it.
    const template = readFileSync(join(__dirname, "../tools/video/skills/product-tour-video/assets/storyboard/tour.html"), "utf8");
    expect(template).toContain('<script src="storyboard.js"></script>');
    expect(template).toMatch(/SB\.beats\.map\(\(b, i\) => `<section class="beat"/);
    for (const name of ["renderAt", "TOTAL", "CLICK_TIMES", "LABEL_TIMES", "END_AT"]) expect(template).toContain(`window.${name}`);
  });
});
