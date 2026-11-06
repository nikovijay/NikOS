import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init, keyFor, runInit } from "../src/commands/init";

const tmp = () => mkdtempSync(join(tmpdir(), "nikos-init-"));

describe("init", () => {
  it("scaffolds a valid intent folder in an empty dir", () => {
    const root = tmp();
    const r = init(root, { name: "Hello Todo" });
    expect(r.skipped).toEqual([]);
    expect(r.created.sort()).toEqual(
      ["constitution.md", "decisions.md", "features/getting-started/first-story.feature", "plans/.gitkeep", "state.yaml", "storymap.yaml"].sort(),
    );
    expect(r.validation.errors).toEqual([]);
    expect(r.validation.warnings).toEqual([]);
    expect(readFileSync(join(root, "intent/storymap.yaml"), "utf8")).toContain("key: HT\n");
    expect(readFileSync(join(root, "intent/constitution.md"), "utf8")).toContain("name: Hello Todo");
    expect(readFileSync(join(root, "intent/features/getting-started/first-story.feature"), "utf8")).toMatch(/^@HT-1 /);
  });

  it("does not overwrite existing files", () => {
    const root = tmp();
    mkdirSync(join(root, "intent"));
    writeFileSync(join(root, "intent/constitution.md"), "my own vision\n");
    const r = init(root, { name: "Hello Todo" });
    expect(r.skipped).toEqual(["constitution.md"]);
    expect(r.created).toHaveLength(5);
    expect(readFileSync(join(root, "intent/constitution.md"), "utf8")).toBe("my own vision\n");
  });

  it("changes nothing when run twice", () => {
    const root = tmp();
    init(root, { name: "Hello Todo" });
    const before = readFileSync(join(root, "intent/state.yaml"), "utf8");
    const again = init(root, { name: "Something Else", key: "SE" });
    expect(again.created).toEqual([]);
    expect(again.skipped).toHaveLength(6);
    expect(readFileSync(join(root, "intent/state.yaml"), "utf8")).toBe(before);
  });

  it("derives a project key from the name and accepts an override", () => {
    expect(keyFor("Hello Todo")).toBe("HT");
    expect(keyFor("nikos")).toBe("NIK");
    expect(keyFor("my-cool app")).toBe("MCA");
    const root = tmp();
    init(root, { name: "Hello Todo", key: "todo" });
    expect(readFileSync(join(root, "intent/state.yaml"), "utf8")).toContain("TODO-1:");
    expect(() => init(tmp(), { key: "1x" })).toThrow("isn't a valid project key");
  });

  it("refuses --name or --key with no value instead of falling back to the folder name", () => {
    const root = tmp();
    for (const args of [["--dir", root, "--name"], ["--name", "--key", "HT", "--dir", root], ["--dir", root, "--key", ""]]) {
      expect(runInit(args)).toBe(1);
    }
    expect(existsSync(join(root, "intent"))).toBe(false);
    expect(runInit(["--dir", root, "--name", "Hello Todo"])).toBe(0);
  });
});
