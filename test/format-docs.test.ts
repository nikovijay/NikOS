import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";

const root = join(__dirname, "..");
const formatDoc = readFileSync(join(root, "docs/format.md"), "utf8");
const mappingDoc = readFileSync(join(root, "docs/intentdocs-mapping.md"), "utf8");
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
  { heading: "bets/&lt;bet-id&gt;.md (optional)", pattern: /^bets\/[a-z0-9-]+\.md$/ },
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

describe("intentdocs mapping", () => {
  it("maps or marks local-only every field the example uses", () => {
    const storymap = parse(readFileSync(join(example, "storymap.yaml"), "utf8"));
    const state = parse(readFileSync(join(example, "state.yaml"), "utf8"));
    const fields = new Set<string>([
      // constitution
      "`name`", "`idea`", "`## Users`", "`## Problem`", "`## Switch`", "`## First`", "`## Proof`",
      // storymap
      ...Object.keys(storymap).map((k) => `\`${k}\``),
      "`activities[].id`", "`activities[].title`", "`releases[].number`", "`releases[].title`",
      // feature tags and description
      "`@release-N`", "`@activity-<id>`", "`As a …`", "`I want …`", "`So that …`", "`@AC<n>`",
      // plans
      "`summary`", "`**Why:**`", "`**Criteria:**`", "`**Files:**`", "`**Tests:**`", "`supersedes`",
      // decisions
      "`**Category:**`", "`**Supersedes:**`",
      // state
      ...Object.keys(state.stories["HT-2"]).map((k) => `\`${k}\``),
      "`run.queue`",
      ...["todo", "in_progress", "needs_rework", "done"].map((s) => `\`status: ${s}\``),
      // bets
      "`bets/*.md`",
    ]);
    fields.delete("`status`"); // covered by the status: <value> rows
    fields.delete("`activities`"); // covered by activities[] rows
    fields.delete("`releases`"); // covered by releases[] rows
    for (const f of fields) {
      expect(mappingDoc, `mapping covers ${f}`).toContain(f);
    }
  });

  it("gives every mapping row an intentdocs field or local-only", () => {
    const rows = mappingDoc.split("\n").filter((l) => l.startsWith("| `") || l.startsWith("| file") || l.startsWith("| entry") || l.startsWith("| scenario") || l.startsWith("| description") || l.startsWith("| step"));
    expect(rows.length).toBeGreaterThan(30);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      expect(cells[2], row).not.toBe("");
    }
  });
});
