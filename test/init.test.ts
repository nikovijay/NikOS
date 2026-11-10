import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init, keyFor, runInit } from "../src/commands/init";

const tmp = () => mkdtempSync(join(tmpdir(), "nikos-init-"));

describe("init", () => {
  it("scaffolds maps/<key>/ and the root files in an empty dir", () => {
    const root = tmp();
    const r = init(root, { name: "Hello Todo" });
    expect(r.skipped).toEqual([]);
    expect(r.created.sort()).toEqual(
      ["constitution.md", "decisions.md", "maps/ht/delivery.yaml", "maps/ht/features/getting-started/first-story.feature", "maps/ht/plans/.gitkeep", "maps/ht/state.yaml", "maps/ht/storymap.yaml"].sort(),
    );
    expect(r.validation.errors).toEqual([]);
    expect(r.validation.warnings).toEqual([]);
    expect(readFileSync(join(root, "maps/ht/storymap.yaml"), "utf8")).toContain("key: HT\n");
    expect(readFileSync(join(root, "constitution.md"), "utf8")).toContain("name: Hello Todo");
    expect(readFileSync(join(root, "maps/ht/features/getting-started/first-story.feature"), "utf8")).toMatch(/^@HT-1 /);
  });

  it("does not overwrite existing files", () => {
    const root = tmp();
    mkdirSync(join(root, "maps", "ht"), { recursive: true });
    writeFileSync(join(root, "constitution.md"), "my own vision\n");
    const r = init(root, { name: "Hello Todo" });
    expect(r.skipped).toEqual(["constitution.md"]);
    expect(r.created).toHaveLength(6);
    expect(readFileSync(join(root, "constitution.md"), "utf8")).toBe("my own vision\n");
  });

  it("refuses to run again over its own map, and changes nothing", () => {
    const root = tmp();
    init(root, { name: "Hello Todo" });
    const before = readFileSync(join(root, "maps/ht/state.yaml"), "utf8");
    expect(() => init(root, { name: "Hello Todo" })).toThrow("maps/ht/ already exists");
    expect(readFileSync(join(root, "maps/ht/state.yaml"), "utf8")).toBe(before);
  });

  it("derives a project key from the name and accepts an override", () => {
    expect(keyFor("Hello Todo")).toBe("HT");
    expect(keyFor("nikos")).toBe("NIK");
    expect(keyFor("my-cool app")).toBe("MCA");
    const root = tmp();
    init(root, { name: "Hello Todo", key: "todo" });
    expect(readFileSync(join(root, "maps/todo/state.yaml"), "utf8")).toContain("TODO-1:");
    expect(() => init(tmp(), { key: "1x" })).toThrow("isn't a valid project key");
  });

  it("refuses --name or --key with no value instead of falling back to the folder name", () => {
    const root = tmp();
    for (const args of [["--dir", root, "--name"], ["--name", "--key", "HT", "--dir", root], ["--dir", root, "--key", ""]]) {
      expect(runInit(args)).toBe(1);
    }
    expect(existsSync(join(root, "maps", "ht"))).toBe(false);
    expect(runInit(["--dir", root, "--name", "Hello Todo"])).toBe(0);
  });
});
