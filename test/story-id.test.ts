import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STORY_ID, STORY_ID_PATTERN } from "../src/lib/project";

const schema = (name: string) => readFileSync(join(__dirname, "..", "schemas", name), "utf8");

describe("story ids", () => {
  it("accepts a one-part key and a group-map key", () => {
    expect(STORY_ID.test("HT-1")).toBe(true);
    expect(STORY_ID.test("PAY-CHK-12")).toBe(true);
    expect(STORY_ID.test("task-9")).toBe(false);
    expect(STORY_ID.test("PAY-chk-1")).toBe(false);
    expect(STORY_ID.test("PAY-CHK")).toBe(false);
  });

  it("keeps every schema on the same pattern", () => {
    for (const file of ["state.schema.json", "approvals.schema.json", "storymap.schema.json"]) {
      expect(schema(file)).toContain(STORY_ID_PATTERN);
    }
  });
});
