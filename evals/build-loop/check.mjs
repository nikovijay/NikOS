#!/usr/bin/env node
// Checks a recorded build-a-story run: the playbook's steps ran in order, and
// the task list was shown again every time a step changed state.
// Usage: node evals/build-loop/check.mjs <run.jsonl>
// The run is a Claude Code transcript or `claude -p --output-format stream-json`.
import { readFileSync } from "node:fs";

/** Assistant tool calls and text from a transcript, in order. */
export function readRun(text) {
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "assistant") continue;
    for (const c of o.message?.content ?? []) {
      if (c.type === "text") events.push({ kind: "text", text: c.text });
      if (c.type !== "tool_use") continue;
      const input = c.input ?? {};
      if (/todo|update_plan/i.test(c.name)) events.push({ kind: "list" });
      else if (c.name === "Bash") events.push({ kind: "bash", command: input.command ?? "" });
      else if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name)) events.push({ kind: "edit", path: input.file_path ?? "" });
    }
  }
  return events;
}

/** A Markdown checklist of at least `min` items counts as showing the list. */
const isChecklist = (text, min = 5) => (text.match(/^\s*- \[[ xX~-]\]/gm) ?? []).length >= min;

/**
 * Playbook steps, from the commands and edits that belong to them.
 * 3 is split: 3.1 creates the plan file, 3.2 writes the approach into it.
 */
function steps(event) {
  if (event.kind === "edit") {
    if (/\/maps\/[^/]+\/plans\/[^/]+\.v\d+\.md$/.test(event.path)) return [{ step: 3.2 }];
    if (/\/maps\//.test(event.path)) return [];
    return [{ step: 5 }];
  }
  const out = [];
  for (const m of event.command.matchAll(/nikos\s+(next|clear|plan new|state set|verify|decide)\b\s*([A-Z][A-Z0-9]*-\d+)?(?:\s+(\w+))?/g)) {
    const [, cmd, story, arg] = m;
    if (cmd === "next") out.push({ step: 1 });
    else if (cmd === "clear") out.push({ step: 2, story });
    else if (cmd === "plan new") out.push({ step: 3.1, story });
    else if (cmd === "state set") out.push({ step: arg === "done" ? 8 : 4, story });
    else if (cmd === "verify") out.push({ step: story || arg !== "setup" ? 6 : 5, story });
    else if (cmd === "decide") out.push({ step: 7 });
  }
  return out;
}

/** Going back to build or verify again is the playbook's own loop; any other step back is drift. */
const allowedBack = (from, to) => (to === 5 || to === 6) && from >= 5;

export function checkRun(events) {
  const problems = [];
  let story, max = 0, shown = false, shownSinceStep = false;
  for (const e of events) {
    if (e.kind === "list" || (e.kind === "text" && isChecklist(e.text))) {
      shown = shownSinceStep = true;
      continue;
    }
    for (const s of e.kind === "text" ? [] : steps(e)) {
      // A new story starts the playbook again. Verifying another story is a
      // regression check, not a switch.
      const switches = s.story && s.step !== 6;
      if (s.step === 1 || (switches && story && s.story !== story)) max = 0;
      if (switches) story = s.story;
      const label = `${story ?? "?"} step ${Math.floor(s.step)}`;
      if (!shown) problems.push(`${label} ran before the task list was shown`), (shown = true);
      if (s.step < max && !allowedBack(max, s.step)) {
        problems.push(`${label} ran after step ${Math.floor(max)}: out of order`);
        continue;
      }
      if (Math.floor(s.step) > Math.floor(max)) {
        if (max > 0 && !shownSinceStep) problems.push(`${label} started without the task list being updated after step ${Math.floor(max)}`);
        shownSinceStep = false;
      }
      max = Math.max(max, s.step);
    }
  }
  return { pass: problems.length === 0, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node evals/build-loop/check.mjs <run.jsonl>");
    process.exit(1);
  }
  const r = checkRun(readRun(readFileSync(file, "utf8")));
  console.log(r.pass ? "✓ steps in order, task list kept current" : r.problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(r.pass ? 0 : 1);
}
