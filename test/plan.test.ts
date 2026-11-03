import { describe, it, expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { newPlan, planVersions } from "../src/commands/plan";
import { validate } from "../src/commands/validate";
import { copyExample } from "./helpers";

describe("plan new", () => {
  it("writes v1 when none exist", () => {
    const dir = copyExample();
    const path = newPlan("HT-3", { dir, date: "2026-11-03", summary: "Drag to reorder." });
    expect(path).toBe(join(dir, "plans/HT-3.v1.md"));
    const text = readFileSync(path, "utf8");
    expect(text).toContain("story: HT-3\nversion: 1\ncreated: 2026-11-03\nsummary: Drag to reorder.");
    expect(text).not.toContain("supersedes");
  });

  it("writes v3 after v2 and leaves v1 and v2 unchanged", () => {
    const dir = copyExample();
    const v1 = readFileSync(join(dir, "plans/HT-1.v1.md"), "utf8");
    const v2 = readFileSync(join(dir, "plans/HT-1.v2.md"), "utf8");
    const path = newPlan("HT-1", { dir });
    expect(path).toBe(join(dir, "plans/HT-1.v3.md"));
    expect(readFileSync(path, "utf8")).toContain("version: 3");
    expect(readFileSync(path, "utf8")).toContain("supersedes: 2");
    expect(readFileSync(join(dir, "plans/HT-1.v1.md"), "utf8")).toBe(v1);
    expect(readFileSync(join(dir, "plans/HT-1.v2.md"), "utf8")).toBe(v2);
    expect(planVersions(dir, "HT-1")).toEqual([1, 2, 3]);
  });

  it("creates the plans folder if it is missing", () => {
    const dir = copyExample();
    rmSync(join(dir, "plans"), { recursive: true });
    expect(newPlan("HT-2", { dir })).toBe(join(dir, "plans/HT-2.v1.md"));
  });

  it("refuses unknown or malformed story ids", () => {
    const dir = copyExample();
    expect(() => newPlan("HT-9", { dir })).toThrow("HT-9 is not in storymap.yaml");
    expect(() => newPlan("ht-1", { dir })).toThrow("is not a story id");
  });

  it("keeps the project valid", () => {
    const dir = copyExample();
    newPlan("HT-1", { dir });
    expect(validate(dir).errors).toEqual([]);
  });
});
