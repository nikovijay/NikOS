import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  MemoryStore, withStore, init, newStory, newStep, addRelease, moveStory, setState, validate, suggest, exportMap, decide, newPlan, storyMapOf, store,
} from "../src/index";
import { walk } from "../src/lib/project";
import { exampleDir } from "./helpers";

/** The hello-todo example's files, as a host's API would hand them over. */
const exampleFiles = () =>
  Object.fromEntries(walk(exampleDir).map((p) => [relative(exampleDir, p).split("\\").join("/"), readFileSync(p, "utf8")]));

describe("memory store", () => {
  it("sets up a repo, adds stories and releases, and lists the changed files, all without the disk", () => {
    const repo = new MemoryStore();
    const changes = withStore(repo, () => {
      const r = init(repo.root, { name: "Tip Calc", key: "TC" });
      expect(r.validation.errors).toEqual([]);
      newStep({ title: "Split the bill", activity: "getting-started" }, repo.root);
      newStory({ title: "Split evenly", activity: "getting-started", step: "split-the-bill" }, repo.root);
      addRelease({ title: "Beta", goal: "Ten people use it every day." }, repo.root);
      moveStory({ id: "TC-2", to: 2 }, repo.root);
      decide({ title: "Round to the cent", why: "People pay in cents", story: "TC-2" }, repo.root);
      newPlan("TC-2", { dir: repo.root, date: "2026-11-06" });
      expect(validate(repo.root).errors).toEqual([]);
      expect(suggest(repo.root).options[0].label).toBe("Build TC-1: First story");
      return repo.changes();
    });
    expect(changes.map((c) => c.path)).toEqual([
      "constitution.md",
      "decisions.md",
      "maps/tc/delivery.yaml",
      "maps/tc/features/getting-started/first-story.feature",
      "maps/tc/features/getting-started/split-evenly.feature",
      "maps/tc/plans/.gitkeep",
      "maps/tc/plans/TC-2.v1.md",
      "maps/tc/state.yaml",
      "maps/tc/storymap.yaml",
    ]);
    expect(changes.find((c) => c.path === "maps/tc/features/getting-started/split-evenly.feature")!.text).toMatch(/^@TC-2 @release-2 /);
    expect(existsSync(join(repo.root, "maps", "tc"))).toBe(false);
  });

  it("reads a repo handed over as files, and writes only what changed", () => {
    const repo = new MemoryStore(exampleFiles());
    withStore(repo, () => {
      const intent = join(repo.root, "maps", "ht");
      expect(storyMapOf(intent).releases.map((r) => r.title)).toEqual(["MVP", "Enhancements"]);
      setState("HT-3", "cancelled", { dir: intent, reason: "Not this year", date: "2026-11-06" });
      expect(exportMap(intent, "prd")).toContain("## Cancelled\n\n- HT-3: Reorder tasks. Not this year");
    });
    expect(repo.changes().map((c) => c.path)).toEqual(["maps/ht/delivery.yaml", "maps/ht/state.yaml"]);
    expect(store().read(join(exampleDir, "maps/ht/state.yaml"))).toContain("status: todo"); // the disk is untouched
  });

  it("refuses to replace a file written with create, like the disk does", () => {
    const repo = new MemoryStore({ "maps/ht/plans/HT-1.v1.md": "x" });
    expect(() => repo.write(join(repo.root, "maps/ht/plans/HT-1.v1.md"), "y", { create: true })).toThrow("EEXIST");
    expect(() => repo.read(join(repo.root, "nope"))).toThrow("ENOENT");
    expect(repo.list(join(repo.root, "maps", "ht"))).toEqual(["plans"]);
  });
});
