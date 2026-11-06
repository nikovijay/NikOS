import { dirname } from "node:path";
import { noEntry, storyState, updateStory } from "../lib/state-files.js";
import { STORY_ID, findIntentDir, read, specHash } from "../lib/project.js";
import { featureFor } from "./clear.js";
import { formatResult, validate } from "./validate.js";
import { verify } from "./verify.js";

export type Status = "todo" | "in_progress" | "needs_rework" | "done" | "cancelled";

/**
 * The moves docs/format.md allows. `done` also needs the story's scenarios to pass; `cancelled`
 * needs a reason. Approval isn't a status: it's a person's entry in approvals.yaml.
 */
const MOVES: Record<Status, Status[]> = {
  todo: ["in_progress", "cancelled"],
  in_progress: ["needs_rework", "done", "cancelled"],
  needs_rework: ["in_progress", "cancelled"],
  done: ["needs_rework"],
  cancelled: ["todo"],
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

export interface StateOptions {
  dir?: string;
  by?: string;
  date?: string;
  /** Why the story is cancelled; required for a move to cancelled. */
  reason?: string;
  /** The time recorded as done_at; tests pin it. */
  now?: string;
}

export function setState(story: string, to: Status, opts: StateOptions = {}): StateResult {
  if (!STORY_ID.test(story)) throw new StateError(`'${story}' is not a story id (expected e.g. HT-1)`);
  if ((to as string) === "approved") throw new StateError(`Approval isn't a status: a person approves ${story} with nikos approve, or by reviewing a change to intent/approvals.yaml`);
  if (!(to in MOVES)) throw new StateError(`'${to}' is not a status (${Object.keys(MOVES).join(", ")})`);
  if (to === "cancelled" && !opts.reason?.trim()) throw new StateError(`Say why ${story} is cancelled: --reason "<why>"`);
  const intentDir = findIntentDir(opts.dir ?? process.cwd());
  const from = storyState(intentDir, story)?.status as Status | undefined;
  if (!from) throw new StateError(noEntry(intentDir, story));
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

  const feature = featureFor(story, dirname(intentDir));
  // A Document keeps comments and the order of everything we don't touch.
  updateStory(intentDir, story, (doc, entry) => {
    doc.setIn([...entry, "status"], to);
    if (opts.by && to === "in_progress") doc.setIn([...entry, "claimed_by"], opts.by);
    if (to === "done") {
      // What the scenarios proved: validate warns if the feature changes afterwards. done_at
      // marks this done, so an approval of an earlier done doesn't carry over.
      if (feature) doc.setIn([...entry, "spec_hash"], specHash(read(feature)));
      doc.setIn([...entry, "done_at"], opts.now ?? new Date().toISOString());
    }
    if (to === "cancelled") doc.setIn([...entry, "cancelled_reason"], opts.reason!.trim());
    else doc.deleteIn([...entry, "cancelled_reason"]);
    doc.setIn([...entry, "updated"], opts.date ?? new Date().toISOString().slice(0, 10));
  });
  return result;
}

export function runState(args: string[]): number {
  const [sub, story, to, ...rest] = args;
  if (sub !== "set" || !story || !to) {
    console.error("Usage: nikos state set <story-id> <todo|in_progress|needs_rework|done|cancelled> [--by <name>] [--reason <why>] [--dir <path>]");
    return 1;
  }
  const opt = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  try {
    const r = setState(story, to as Status, { dir: opt("dir"), by: opt("by"), reason: opt("reason") });
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
