import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDocument } from "yaml";
import { STORY_ID, findIntentDir, read } from "../lib/project.js";
import { formatResult, validate } from "./validate.js";
import { verify } from "./verify.js";

export type Status = "todo" | "in_progress" | "needs_rework" | "done";

/** The moves docs/format.md allows. `done` also needs the story's scenarios to pass. */
const MOVES: Record<Status, Status[]> = {
  todo: ["in_progress"],
  in_progress: ["needs_rework", "done"],
  needs_rework: ["in_progress"],
  done: ["needs_rework"],
};

export interface StateResult {
  story: string;
  from: Status;
  to: Status;
  /** Scenarios that stopped a move to done. */
  failing: string[];
  /** The runner's output when it gated the move. */
  output?: string;
}

/** Scenario names from a cucumber-js or behave run that didn't pass. */
export function failingScenarios(output: string): string[] {
  const names = new Set<string>();
  // cucumber-js: "1) Scenario: AC1 — Title # intent/features/…"
  for (const m of output.matchAll(/^\s*\d+\) Scenario: (.+?)\s+#/gm)) names.add(m[1]);
  // behave: "Failing scenarios:" then "  intent/features/…:8  AC1 — Title"
  const behave = /Failing scenarios:\n((?:\s+\S+:\d+\s+.+\n?)+)/.exec(output);
  if (behave) for (const line of behave[1].split("\n")) {
    const m = /^\s+\S+:\d+\s+(.+?)\s*$/.exec(line);
    if (m) names.add(m[1]);
  }
  return [...names];
}

export class StateError extends Error {
  constructor(message: string, readonly result?: StateResult) {
    super(message);
  }
}

export function setState(story: string, to: Status, opts: { dir?: string; by?: string; date?: string } = {}): StateResult {
  if (!STORY_ID.test(story)) throw new StateError(`'${story}' is not a story id (expected e.g. HT-1)`);
  if (!(to in MOVES)) throw new StateError(`'${to}' is not a status (todo, in_progress, needs_rework, done)`);
  const intentDir = findIntentDir(opts.dir ?? process.cwd());
  const path = join(intentDir, "state.yaml");
  // A Document keeps comments and the order of everything we don't touch.
  const doc = parseDocument(read(path));
  const from = doc.getIn(["stories", story, "status"]) as Status | undefined;
  if (!from) throw new StateError(`${story} has no entry in state.yaml`);
  if (!MOVES[from]?.includes(to)) {
    throw new StateError(`${story} can't move from ${from} to ${to}. From ${from} it can move to: ${MOVES[from].join(", ")}`);
  }

  const result: StateResult = { story, from, to, failing: [] };
  if (to === "done") {
    let run;
    try {
      run = verify(dirname(intentDir), story);
    } catch (err) {
      throw new StateError(`${story} stays ${from}: its scenarios couldn't run. ${(err as Error).message}`, result);
    }
    if (run.status !== 0) {
      result.failing = failingScenarios(run.output);
      result.output = run.output;
      const list = result.failing.length ? `:\n${result.failing.map((s) => `  ✗ ${s}`).join("\n")}` : ". See the runner output.";
      throw new StateError(`${story} stays ${from}: its scenarios don't all pass${list}`, result);
    }
    result.output = run.output;
  }

  doc.setIn(["stories", story, "status"], to);
  if (opts.by && to === "in_progress") doc.setIn(["stories", story, "claimed_by"], opts.by);
  doc.setIn(["stories", story, "updated"], opts.date ?? new Date().toISOString().slice(0, 10));
  writeFileSync(path, doc.toString());
  return result;
}

export function runState(args: string[]): number {
  const [sub, story, to, ...rest] = args;
  if (sub !== "set" || !story || !to) {
    console.error("Usage: nikos state set <story-id> <todo|in_progress|needs_rework|done> [--by <name>] [--dir <path>]");
    return 1;
  }
  const opt = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  try {
    const r = setState(story, to as Status, { dir: opt("dir"), by: opt("by") });
    console.log(`${r.story}: ${r.from} → ${r.to}`);
  } catch (err) {
    const e = err as StateError;
    if (e.result?.output && !e.result.failing.length) console.error(e.result.output);
    console.error(`✗ ${e.message}`);
    return 1;
  }
  const v = validate(opt("dir") ?? process.cwd());
  if (v.errors.length) {
    console.error(formatResult(v));
    return 1;
  }
  return 0;
}
