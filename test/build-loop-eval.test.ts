import { describe, it, expect } from "vitest";
// @ts-expect-error plain JavaScript eval script
import { checkRun, readRun } from "../evals/build-loop/check.mjs";

// Transcript lines in Claude Code's format: assistant messages with tool calls.
const tool = (name: string, input: object) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
const bash = (command: string) => tool("Bash", { command });
const edit = (file_path: string) => tool("Edit", { file_path });
const list = () => tool("TodoWrite", { todos: [] });
const checklist = (done: number) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: Array.from({ length: 9 }, (_, i) => `- [${i < done ? "x" : " "}] ${i + 1}. step`).join("\n") }] } });

/** A run that follows build-a-story for HT-2, showing the list after every step. */
const good = [
  list(),
  bash("npx nikos next"), list(),
  bash("npx nikos clear HT-2"), list(),
  bash("npx nikos plan new HT-2"), edit("/repo/intent/plans/HT-2.v1.md"), list(),
  bash("npx nikos state set HT-2 in_progress"), list(),
  edit("/repo/src/tasks.js"), edit("/repo/test/steps/tasks.steps.mjs"), list(),
  bash("npx nikos verify HT-2"), edit("/repo/src/tasks.js"), bash("npx nikos verify HT-2 && npx nikos verify"), list(),
  bash('npx nikos decide "Tasks are kept in memory" --story HT-2 --why "No storage yet"'), list(),
  bash("npx nikos state set HT-2 done"), list(),
];
const run = (lines: string[]) => checkRun(readRun(lines.join("\n")));

describe("build-loop eval", () => {
  it("passes a run that keeps the steps in order and the task list current", () => {
    expect(run(good)).toEqual({ pass: true, problems: [] });
    // A Markdown checklist in the reply counts, for tools with no built-in list.
    expect(run(good.map((l) => (l === list() ? checklist(3) : l)))).toEqual({ pass: true, problems: [] });
  });

  it("fails a recorded build-a-story run with a step out of order or a stale task list", () => {
    // Marked in progress before the approach was written into the plan.
    const early = [list(), bash("npx nikos next"), list(), bash("npx nikos clear HT-2"), list(), bash("npx nikos plan new HT-2; npx nikos state set HT-2 in_progress"), list(), edit("/repo/intent/plans/HT-2.v1.md"), list()];
    expect(run(early).problems).toContain("HT-2 step 3 ran after step 4: out of order");

    // The list was shown once, then never updated.
    const stale = good.filter((l, i) => i === 0 || l !== list());
    const r = run(stale);
    expect(r.pass).toBe(false);
    expect(r.problems).toContain("HT-2 step 3 started without the task list being updated after step 2");

    // Work started before any list was shown.
    expect(run(good.slice(1)).problems[0]).toBe("? step 1 ran before the task list was shown");
  });

  it("treats verifying another story as a regression check, not a new story", () => {
    const i = good.indexOf(bash("npx nikos verify HT-2 && npx nikos verify"));
    const withCheck = [...good.slice(0, i), bash("npx nikos verify HT-2; npx nikos verify HT-1"), ...good.slice(i + 1)];
    expect(run(withCheck)).toEqual({ pass: true, problems: [] });
  });
});
