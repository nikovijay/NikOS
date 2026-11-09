import { noEntry, storyState, updateStory } from "../lib/state-files.js";
import { STORY_ID, read, specHash } from "../lib/project.js";
import { homeOf, storyMapFor } from "../lib/maps.js";
import { codeIsDirty, headOf } from "../lib/git.js";
import { featureFor } from "./clear.js";
import { hasSummary, writeMapSummary } from "../lib/map-summary.js";
import { validate } from "./validate.js";
import { verify, type VerifyResult } from "./verify.js";

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
  /** A team repo with changes not yet committed: the proof is for the commit, not these changes. */
  dirty?: boolean;
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

/**
 * Why scenarios didn't pass when it's the steps, not the product: steps still returning
 * "pending", or with no step definition yet. From the cucumber-js or behave step tally.
 */
export function stepTrouble(output: string): string[] {
  const tally = /^\d+ steps? \(([^)]*)\)/m.exec(output)?.[1] ?? /^\d+ steps? passed.*$/m.exec(output)?.[0] ?? "";
  const n = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(tally)?.[1] ?? 0);
  const steps = (k: number) => `${k} ${k === 1 ? "step" : "steps"}`;
  const out: string[] = [];
  if (n("pending")) out.push(`${steps(n("pending"))} still ${n("pending") === 1 ? "returns" : "return"} "pending": replace it with a real check in the step definitions`);
  if (n("undefined")) out.push(`${steps(n("undefined"))} ${n("undefined") === 1 ? "has" : "have"} no step definition yet: add ${n("undefined") === 1 ? "it" : "them"} to the step definitions (the runner's output has a snippet to start from)`);
  return out;
}

export class StateError extends Error {
  constructor(message: string, readonly result?: StateResult) {
    super(message);
  }
}

export interface StateOptions {
  dir?: string;
  /** The map, in a group repo with several. */
  map?: string;
  by?: string;
  date?: string;
  /** Why the story is cancelled; required for a move to cancelled. */
  reason?: string;
  /** The time recorded as done_at; tests pin it. */
  now?: string;
}

export function setState(story: string, to: Status, opts: StateOptions = {}): StateResult {
  if (!STORY_ID.test(story)) throw new StateError(`'${story}' is not a story id (expected e.g. HT-1 or PAY-CHK-12)`);
  if ((to as string) === "approved") throw new StateError(`Approval isn't a status: a person approves ${story} with nikos approve, or by reviewing a change to intent/approvals.yaml`);
  if (!(to in MOVES)) throw new StateError(`'${to}' is not a status (${Object.keys(MOVES).join(", ")})`);
  if (to === "cancelled" && !opts.reason?.trim()) throw new StateError(`Say why ${story} is cancelled: --reason "<why>"`);
  const ref = storyMapFor(opts.dir ?? process.cwd(), { story, map: opts.map });
  const home = homeOf(ref);
  // In a team repo a story with no status file is todo: its first move creates the file.
  const from = (storyState(home, story)?.status ?? (ref.team ? "todo" : undefined)) as Status | undefined;
  if (!from) throw new StateError(noEntry(home, story));
  if (!MOVES[from]?.includes(to)) {
    throw new StateError(`${story} can't move from ${from} to ${to}. From ${from} it can move to: ${MOVES[from].join(", ")}`);
  }

  const result: StateResult = { story, from, to, failing: [] };
  let run: VerifyResult | undefined;
  let commit: string | undefined;
  if (to === "done") {
    try {
      run = verify(ref.root, story, { map: ref.id });
    } catch (err) {
      throw new StateError(`${story} stays ${from}: its scenarios couldn't run. ${(err as Error).message}`, result);
    }
    if (run.status !== 0) {
      result.failing = failingScenarios(run.output);
      result.output = run.output;
      const trouble = stepTrouble(run.output);
      const list =
        (result.failing.length ? `:\n${result.failing.map((s) => `  ✗ ${s}`).join("\n")}` : ". See the runner output.") +
        trouble.map((t) => `\n  → ${t}`).join("");
      throw new StateError(`${story} stays ${from}: its scenarios don't all pass${list}`, result);
    }
    result.output = run.output;
    if (ref.team) {
      // The proof is for the commit it ran at, so approval can check nothing has changed since.
      commit = headOf(ref.root);
      if (!commit) throw new StateError(`${story} stays ${from}: this team repo has no commit yet. Commit first, so the proof has a commit to point at`, result);
      result.dirty = codeIsDirty(ref.root);
    }
  }

  const feature = featureFor(story, ref.root, ref.id);
  // A Document keeps comments and the order of everything we don't touch.
  updateStory(home, story, (doc, entry) => {
    doc.setIn([...entry, "status"], to);
    // A team's status says which feature it was written against, so the group can tell a stale one.
    if (ref.team && feature && to !== "done") doc.setIn([...entry, "spec_hash"], specHash(read(feature)));
    if (opts.by && to === "in_progress") doc.setIn([...entry, "claimed_by"], opts.by);
    if (to === "done") {
      // What the scenarios proved: validate warns if the feature changes afterwards. done_at
      // marks this done, so an approval of an earlier done doesn't carry over.
      if (feature) doc.setIn([...entry, "spec_hash"], specHash(read(feature)));
      doc.setIn([...entry, "done_at"], opts.now ?? new Date().toISOString());
      if (ref.team && commit && run) {
        doc.setIn([...entry, "tested_commit"], commit);
        doc.setIn([...entry, "evidence"], { run_at: opts.now ?? new Date().toISOString(), runner: run.stack === "python" ? "behave" : "cucumber", commit, ok: true });
      }
    }
    if (to === "cancelled") doc.setIn([...entry, "cancelled_reason"], opts.reason!.trim());
    else doc.deleteIn([...entry, "cancelled_reason"]);
    doc.setIn([...entry, "updated"], opts.date ?? new Date().toISOString().slice(0, 10));
  }, { create: !!ref.team });
  // The map's delivery.yaml says what its files say: written with each change, so `nikos validate` finds it current.
  if (hasSummary(ref)) writeMapSummary(ref.root, ref.dir);
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
  let lapsedFor: string | undefined;
  try {
    const r = setState(story, to as Status, { dir: opt("dir"), map: opt("map"), by: opt("by"), reason: opt("reason") });
    console.log(`${r.story}: ${r.from} → ${r.to}`);
    lapsedFor = r.story;
    if (r.dirty) console.log("! The code has uncommitted changes. The proof is for the last commit, not for them: commit the code, then run its scenarios again.");
  } catch (err) {
    const e = err as StateError;
    if (e.result?.output && !e.result.failing.length) console.error(e.result.output);
    console.error(`✗ ${e.message}`);
    return 1;
  }
  const v = validate(opt("dir") ?? process.cwd(), opt("map"), { remote: false });
  // An approval that no longer holds is a warning here: the move above was written, and approve says what's needed.
  // Only the story this command changed is named: another story's lapse is still in nikos validate, not repeated on every set.
  for (const w of v.errors.filter((e) => e.lapse && (!lapsedFor || e.file.includes(lapsedFor) || e.message.includes(lapsedFor)))) console.log(`! ${w.file}: ${w.message}${w.hint ? `\n    → ${w.hint}` : ""}`);
  // The move is written, so a problem found elsewhere is a warning here, not a failed command.
  for (const w of v.errors.filter((e) => !e.lapse)) console.log(`! ${w.file}: ${w.message}${w.hint ? `\n    → ${w.hint}` : ""}`);
  return 0;
}
