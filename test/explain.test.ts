import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { show } from "../src/commands/show";
import { decisionEntries, findDecisions, formatDecisions } from "../src/commands/decisions";
import { decide } from "../src/commands/decide";
import { copyExample, exampleDir } from "./helpers";

const skill = (name: string) => readFileSync(join(__dirname, "../skills", name, "SKILL.md"), "utf8");

describe("nikos show", () => {
  it("summarises the feature and its state", () => {
    const out = show("HT-2", exampleDir);
    expect(out).toContain("HT-2 — See today's top three");
    expect(out).toContain("Status: in_progress (claimed by claude-code, updated 2026-11-03)");
    expect(out).toContain("Release 1 (MVP) · must · effort M");
    expect(out).toContain("Feature: intent/features/tasks/see-todays-top-three.feature");
    expect(out).toContain("  I want to see only my three most important tasks");
    expect(out).toContain("  AC1 — Only three tasks are shown");
    expect(out).toContain("Plan: v1 (intent/plans/HT-2.v1.md) — Rank tasks by importance");
    expect(out).toContain("Bets: fewer-missed-tasks (planning/bets/fewer-missed-tasks.md) — from release 1");
  });

  it("shows the latest plan and the decisions tagged with the story", () => {
    const out = show("HT-1", exampleDir);
    expect(out).toContain("Status: done");
    expect(out).toContain("Plan: v2 (intent/plans/HT-1.v2.md)");
    expect(out).toContain("intent/decisions.md:3 2026-11-03 — Store tasks in localStorage (HT-1)");
    expect(show("HT-3", exampleDir)).toContain("Plan: none yet");
  });

  it("refuses an unknown or malformed story id", () => {
    expect(() => show("HT-99", exampleDir)).toThrow("No feature file is tagged @HT-99");
    expect(() => show("ht-1", exampleDir)).toThrow("not a story id");
  });
});

describe("nikos decisions", () => {
  it("cites the lines of the entry that answers a question", () => {
    const found = findDecisions("Why do we store tasks in localStorage instead of a server?", exampleDir);
    expect(found.map((e) => [e.start, e.end])).toEqual([[3, 8]]);
    const text = formatDecisions("localStorage", found);
    expect(text.startsWith("intent/decisions.md:3-8\n## 2026-11-03 — Store tasks in localStorage (HT-1)")).toBe(true);
    expect(text).toContain("A server can come later");
  });

  it("says none exist when nothing matches", () => {
    expect(findDecisions("dark mode", exampleDir)).toEqual([]);
    expect(formatDecisions("dark mode", [])).toBe('No decision in intent/decisions.md mentions "dark mode".');
    expect(findDecisions("why did we?", exampleDir)).toEqual([]);
  });

  it("finds entries by story id and keeps line numbers right after new entries", () => {
    const dir = copyExample();
    decide({ title: "Use drag handles", why: "Long-press clashes with scrolling.", story: "HT-3", category: "design", date: "2026-11-04" }, dir);
    const entries = decisionEntries(dir);
    expect(entries.map((e) => e.title)).toEqual([
      "2026-11-03 — Store tasks in localStorage (HT-1)",
      "2026-11-03 — Cap today's view at three tasks",
      "2026-11-04 — Use drag handles (HT-3)",
    ]);
    const [hit] = findDecisions("HT-3", dir);
    const lines = readFileSync(join(dir, "decisions.md"), "utf8").split("\n");
    expect(lines[hit.start - 1]).toBe("## 2026-11-04 — Use drag handles (HT-3)");
    expect(lines[hit.end - 1]).toBe("Long-press clashes with scrolling.");
    expect(show("HT-3", dir)).toContain(`intent/decisions.md:${hit.start} 2026-11-04 — Use drag handles (HT-3)`);
  });

  it("skips the commented template in a fresh decisions.md", () => {
    const fresh = readFileSync(join(__dirname, "../templates/intent/decisions.md"), "utf8");
    expect(fresh).toContain("<!--");
    const dir = copyExample();
    writeFileSync(join(dir, "decisions.md"), fresh);
    expect(decisionEntries(dir)).toEqual([]);
  });
});

describe("explain skills", () => {
  it("/intent reads the story with nikos show and answers with citations", () => {
    const text = skill("intent");
    expect(text).toContain("nikos show <story-id>");
    expect(text).toMatch(/status/i);
    expect(text).toContain("`path:line`");
    expect(text).toContain("in the run queue but unclaimed is waiting");
  });

  it("/decisions cites decisions.md lines or says none is recorded, and never invents a reason", () => {
    const text = skill("decisions");
    expect(text).toContain('nikos decisions "<the question or topic>"');
    expect(text).toContain("intent/decisions.md:<lines>");
    expect(text).toContain("No decision about <topic> is recorded in intent/decisions.md.");
    expect(text).toContain("Never invent");
    expect(text).toContain("Log it only once the person tells you the reason.");
  });

  it("/clear-review runs CLEAR, asks an unanchored second reviewer, and works single-model", () => {
    const text = skill("clear-review");
    for (const part of ["clear skill", "sceptical reviewer", "Don't share your own CLEAR results", "single-model review", "only once the person agrees"]) {
      expect(text, part).toContain(part);
    }
  });
});
