import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(__dirname, "..");
const formatDoc = readFileSync(join(root, "docs/format.md"), "utf8");
const example = join(root, "examples/hello-todo/intent");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Path patterns documented in format.md, one per file type.
const documented: { heading: string; pattern: RegExp }[] = [
  { heading: "constitution.md", pattern: /^constitution\.md$/ },
  { heading: "storymap.yaml", pattern: /^storymap\.yaml$/ },
  { heading: "features/&lt;activity&gt;/&lt;story-slug&gt;.feature", pattern: /^features\/[a-z0-9-]+\/[a-z0-9-]+\.feature$/ },
  { heading: "plans/&lt;story-id&gt;.v&lt;N&gt;.md", pattern: /^plans\/[A-Z]+-\d+\.v\d+\.md$/ },
  { heading: "decisions.md", pattern: /^decisions\.md$/ },
  { heading: "state.yaml", pattern: /^state\.yaml$/ },
  { heading: "outreach/&lt;date&gt;-&lt;channel&gt;.md (optional)", pattern: /^outreach\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/ },
];

function section(heading: string): string {
  const start = formatDoc.indexOf(`## ${heading}\n`);
  expect(start, `format.md has a section for ${heading}`).toBeGreaterThan(-1);
  const rest = formatDoc.slice(start + 3);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("format spec", () => {
  it("defines purpose, path and format for every file type", () => {
    for (const { heading } of documented) {
      const body = section(heading);
      expect(body, heading).toContain("**Purpose:**");
      expect(body, heading).toContain("**Path:**");
      expect(body, heading).toContain("**Format:**");
    }
  });

  it("covers every file in the example project", () => {
    for (const file of walk(example)) {
      const rel = relative(example, file);
      const match = documented.some((d) => d.pattern.test(rel));
      expect(match, `${rel} is a documented file type`).toBe(true);
    }
  });
});
