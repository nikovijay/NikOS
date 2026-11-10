// The one write path. Every change the dashboard, the change file (nikos apply) and the chat
// makes goes through runOp: it checks the op's name, the level of the plan, and the ids, then calls
// the command the CLI uses. Dry runs (runOps) do the same work on an in-memory copy of the repo's
// planning and story map files, so nothing is written until a person says so.
import { join, relative, resolve, sep } from "node:path";
import { addRelease, moveStory, removeRelease, renameRelease, reorderRelease } from "../commands/release.js";
import { newActivity, newStep, renameActivity, renameStep } from "../commands/step.js";
import { newStory, renameStory, removeStory } from "../commands/story.js";
import { newMap } from "../commands/map.js";
import { resolveStoryMap, mapDirs } from "../lib/maps.js";
import { diskStore, MemoryStore, store, withStore, type Store } from "../lib/store.js";
import { addDownstream } from "./rollout.js";
import { setSetting } from "../lib/settings.js";
import { checkIn, editKr, newKr, reviseTarget } from "./krs.js";
import { editBet, newBet, reviewBet } from "./bets.js";
import { setAligns, setBetKrs } from "./aligns.js";
import { krLevelProblem, levelOf, planningIssues } from "./levels.js";
import { idProblem, betFieldProblems, decisionProblem, numberProblem, reasonProblem } from "./rules.js";
import { hash, StaleError, checkHash } from "./model.js";
import { validate, validateGroup } from "../commands/validate.js";

export type OpName =
  | "checkin"
  | "kr.new"
  | "kr.edit"
  | "kr.target"
  | "kr.align"
  | "bet.new"
  | "bet.edit"
  | "bet.review"
  | "bet.align"
  | "bet.krs"
  | "story.new"
  | "story.rename"
  | "story.move"
  | "story.remove"
  | "activity.new"
  | "activity.rename"
  | "step.new"
  | "step.rename"
  | "release.new"
  | "release.rename"
  | "release.remove"
  | "release.reorder"
  | "map.new"
  | "setting.set"
  | "downstream.add";

export type Level = "company" | "department" | "group";

export interface Op {
  op: OpName;
  target?: Record<string, string>;
  args: Record<string, unknown>;
  expect?: string;
}

const COMPANY: OpName[] = ["checkin", "kr.new", "kr.edit", "kr.target", "bet.new", "bet.edit", "bet.review", "bet.krs", "setting.set", "downstream.add"];
const DEPARTMENT: OpName[] = [...COMPANY, "kr.align", "bet.align"];
const GROUP: OpName[] = [
  "bet.new",
  "bet.edit",
  "bet.review",
  "bet.align",
  "story.new",
  "story.rename",
  "story.move",
  "story.remove",
  "activity.new",
  "activity.rename",
  "step.new",
  "step.rename",
  "release.new",
  "release.rename",
  "release.remove",
  "release.reorder",
  "map.new",
];

/** Every op name. Typed as a record of OpName, so a name missing here (or extra) fails to compile. */
const NAMES: Record<OpName, true> = {
  checkin: true,
  "kr.new": true,
  "kr.edit": true,
  "kr.target": true,
  "kr.align": true,
  "bet.new": true,
  "bet.edit": true,
  "bet.review": true,
  "bet.align": true,
  "bet.krs": true,
  "story.new": true,
  "story.rename": true,
  "story.move": true,
  "story.remove": true,
  "activity.new": true,
  "activity.rename": true,
  "step.new": true,
  "step.rename": true,
  "release.new": true,
  "release.rename": true,
  "release.remove": true,
  "release.reorder": true,
  "map.new": true,
  "setting.set": true,
  "downstream.add": true,
};

export const OP_NAMES = Object.keys(NAMES) as OpName[];

/** The levels each op is made at, from the three level lists. A group plan has no key results, so kr.* and checkin are refused there. */
export const OP_LEVELS: Record<OpName, Level[]> = Object.fromEntries(
  OP_NAMES.map((name) => [name, (["company", "department", "group"] as Level[]).filter((lv) => (lv === "company" ? COMPANY : lv === "department" ? DEPARTMENT : GROUP).includes(name))]),
) as Record<OpName, Level[]>;

/**
 * The argument names each op reads. Any other name is refused, so a misspelt one is never dropped
 * silently. kr.edit and bet.edit check their own fields, so they aren't listed here.
 */
const ARGS: Partial<Record<OpName, string[]>> = {
  checkin: ["value", "note", "evidence", "date"],
  "kr.new": ["title", "owner", "baseline", "target", "by", "unit", "objective", "aligns_to", "stale_after_days"],
  "kr.target": ["target"],
  "kr.align": ["aligns_to"],
  "bet.new": ["owner", "hypothesis", "review_on", "review", "team", "starts", "deadline", "primary", "also", "aligns_to", "confidence", "dependencies", "evidence"],
  "bet.review": ["decision", "reason", "outcome"],
  "bet.align": ["aligns_to"],
  "bet.krs": ["primary", "also"],
  "story.new": ["title", "activity", "step", "release", "priority", "map"],
  "story.rename": ["title", "confirm", "map"],
  "story.move": ["to", "map"],
  "story.remove": ["map"],
  "activity.new": ["title", "id", "map"],
  "activity.rename": ["title", "map"],
  "step.new": ["title", "activity", "id", "map"],
  "step.rename": ["title", "activity", "map"],
  "release.new": ["title", "goal", "map"],
  "release.rename": ["title", "goal", "map"],
  "release.remove": ["map"],
  "release.reorder": ["to", "map"],
  "map.new": ["bet", "key", "map"],
  "setting.set": ["key", "value"],
  "downstream.add": ["name", "repo", "home"],
};

/**
 * Ops that edit a file that already exists. In a dry run they need the expect the snapshot gave, so
 * a change made against an older version is skipped. Creates don't carry one (their ids are made
 * from the current files).
 */
export const EDITS = new Set<OpName>([
  "checkin",
  "kr.edit",
  "kr.target",
  "kr.align",
  "bet.edit",
  "bet.review",
  "bet.align",
  "bet.krs",
  "story.rename",
  "story.move",
  "story.remove",
  "activity.rename",
  "step.rename",
  "release.rename",
  "release.remove",
  "release.reorder",
]);


const TARGET_KINDS: Record<string, "kr" | "bet" | "story" | "activity" | "step" | "release" | "map"> = {
  kr: "kr",
  bet: "bet",
  story: "story",
  activity: "activity",
  step: "step",
  release: "release",
  map: "map",
};

const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const refs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === "string" && v ? [v] : []);
/** A selector list. Empty means no selector at all, the whole part (the form's blank field, and the CLI's no-flag case). */

/** Refuse an op before anything is read or written: unknown name, level, and ids. */
function precheck(root: string, op: Op): void {
  if (!Object.prototype.hasOwnProperty.call(OP_LEVELS, op.op)) throw new Error(`'${String(op.op)}' isn't a change nikOS knows`);
  const level = levelOf(root);
  if (level === "group" && (op.op.startsWith("kr.") || op.op === "checkin")) throw new Error(krLevelProblem(level)!);
  if (level && !OP_LEVELS[op.op].includes(level as Level)) throw new Error(`${op.op} isn't a change the ${level} plan makes here`);
  for (const [kind, id] of Object.entries(op.target ?? {})) {
    const k = TARGET_KINDS[kind];
    const problem = k ? idProblem(k, id) : `'${kind}' isn't a kind of target nikOS knows`;
    if (problem) throw new Error(problem);
  }
  const allowed = ARGS[op.op];
  if (allowed) for (const k of Object.keys(op.args ?? {})) if (!allowed.includes(k)) throw new Error(`'${k}' isn't an argument of ${op.op}`);
}

/** Check a file's text against the expect an op carries. An empty or missing expect checks nothing. */
function checkFile(abs: string, label: string, expect: string | undefined): void {
  if (!expect || !store().exists(abs)) return;
  checkHash(label, store().read(abs), expect);
}

/** The story map's storymap.yaml, checked against the expect of an op that edits its structure. */
function checkStoryMap(root: string, map: string | undefined, expect: string | undefined): void {
  const ref = resolveStoryMap(root, { map: map });
  checkFile(join(ref.dir, "storymap.yaml"), `maps/${ref.id}/storymap.yaml`, expect);
}

/** Run one op against the store in use. Throws the command's own message. */
function apply(root: string, op: Op): string {
  const a = op.args ?? {};
  const t = op.target ?? {};
  const expect = op.expect;
  const map = str(a.map);
  switch (op.op) {
    case "checkin": {
      const problem = numberProblem("checkin", a.value);
      if (problem) throw new Error(problem);
      checkIn(root, t.kr, { value: a.value as number, note: str(a.note), evidence: str(a.evidence), date: str(a.date), expect });
      return `Checked in ${t.kr}: ${a.value}`;
    }
    case "kr.new":
      newKr(
        {
          id: t.kr,
          title: String(a.title ?? ""),
          owner: String(a.owner ?? ""),
          baseline: num(a.baseline),
          target: num(a.target),
          by: String(a.by ?? ""),
          unit: typeof a.unit === "string" ? a.unit : undefined,
          objective: str(a.objective),
          alignsTo: refs(a.aligns_to),
          staleAfterDays: a.stale_after_days ? num(a.stale_after_days) : undefined,
        },
        root,
      );
      return `Added key result ${t.kr}`;
    case "kr.edit":
      editKr(root, t.kr, a, expect);
      return `Saved key result ${t.kr}`;
    case "kr.target": {
      const problem = numberProblem("target", a.target);
      if (problem) throw new Error(problem);
      reviseTarget(root, t.kr, a.target as number, expect);
      return `Moved the target of ${t.kr} to ${a.target}`;
    }
    case "kr.align":
      setAligns(root, "kr", t.kr, refs(a.aligns_to), expect);
      return `Aligned ${t.kr}`;
    case "bet.new":
      newBet(
        {
          id: t.bet,
          owner: String(a.owner ?? ""),
          hypothesis: String(a.hypothesis ?? ""),
          reviewOn: String(a.review_on ?? a.review ?? ""),
          team: str(a.team),
          starts: str(a.starts),
          deadline: str(a.deadline),
          primary: str(a.primary),
          also: refs(a.also),
          alignsTo: refs(a.aligns_to),
          confidence: a.confidence as any,
          dependencies: refs(a.dependencies),
          evidence: str(a.evidence),
        },
        root,
      );
      return `Added bet ${t.bet}`;
    case "bet.edit": {
      if (Object.prototype.hasOwnProperty.call(a, "outcome")) throw new Error("'outcome' can't be edited here");
      const problem = betFieldProblems(a)[0];
      if (problem) throw new Error(problem);
      editBet(root, t.bet, a, expect);
      return `Saved bet ${t.bet}`;
    }
    case "bet.review": {
      const problem = decisionProblem(a.decision) ?? reasonProblem(a.reason);
      if (problem) throw new Error(problem);
      reviewBet(root, t.bet, { decision: a.decision as any, reason: String(a.reason), outcome: a.outcome as any, expect });
      return `Reviewed ${t.bet}: ${a.decision}`;
    }
    case "bet.align":
      setAligns(root, "bet", t.bet, refs(a.aligns_to), expect);
      return `Aligned ${t.bet}`;
    case "bet.krs":
      setBetKrs(root, t.bet, { primary: str(a.primary), also: refs(a.also) }, expect);
      return `Saved the key results of ${t.bet}`;
    case "story.new": {
      const r = newStory({ title: String(a.title ?? ""), activity: String(a.activity ?? ""), step: str(a.step), release: a.release === undefined ? undefined : num(a.release), priority: a.priority as any, map }, root);
      return `Added ${r.id} to release ${r.release}`;
    }
    case "story.rename": {
      renameStory(root, { map, id: t.story, title: String(a.title ?? "") }, expect);
      return `Renamed ${t.story}`;
    }
    case "story.move":
      checkStoryMap(root, map, expect);
      moveStory({ map, id: t.story, to: num(a.to) }, root);
      return `Moved ${t.story} to release ${a.to}`;
    case "story.remove":
      removeStory(root, { map, id: t.story }, expect);
      return `Removed ${t.story}`;
    case "activity.new": {
      const id = newActivity({ title: String(a.title ?? ""), id: str(a.id), map }, root);
      return `Added activity ${id}`;
    }
    case "activity.rename":
      renameActivity(root, { map, id: t.activity, title: String(a.title ?? "") }, expect);
      return `Renamed activity ${t.activity}`;
    case "step.new": {
      const r = newStep({ title: String(a.title ?? ""), activity: String(a.activity ?? ""), id: str(a.id), map }, root);
      return `Added step ${r.id}`;
    }
    case "step.rename":
      renameStep(root, { map, id: t.step, title: String(a.title ?? ""), activity: str(a.activity) }, expect);
      return `Renamed step ${t.step}`;
    case "release.new": {
      const r = addRelease({ map, title: String(a.title ?? ""), goal: str(a.goal) }, root);
      return `Added release ${r.number}`;
    }
    case "release.rename":
      checkStoryMap(root, map, expect);
      renameRelease({ map, number: num(t.release), title: str(a.title) ?? (a.title === undefined ? undefined : ""), goal: a.goal === undefined ? undefined : String(a.goal) }, root);
      return `Renamed release ${t.release}`;
    case "release.remove":
      checkStoryMap(root, map, expect);
      removeRelease({ map, number: num(t.release) }, root);
      return `Removed release ${t.release}`;
    case "release.reorder":
      checkStoryMap(root, map, expect);
      reorderRelease({ map, number: num(t.release), to: num(a.to) }, root);
      return `Moved release ${t.release} to position ${a.to}`;
    case "map.new": {
      const r = newMap({ bet: str(a.bet), key: str(a.key) }, root);
      return `Created maps/${r.id} for bet ${a.bet}`;
    }
    case "setting.set": {
      const key = String(a.key ?? "");
      setSetting(root, key, a.value);
      return `Set ${key}`;
    }
    case "downstream.add": {
      const r = addDownstream(root, { name: String(a.name ?? ""), repo: str(a.repo), home: str(a.home) });
      return `${r.added ? "Added" : "Updated"} ${r.name}`;
    }
  }
  throw new Error(`'${String(op.op)}' isn't a change nikOS knows`);
}

/** The text of the files a dry run needs: planning, the story maps, settings, and the copies of other plans. */
const SNAPSHOT = ["planning", "maps", "nikos.settings.yaml", ".nikos/upstream"];

function snapshotFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (rel: string) => {
    const abs = join(root, rel);
    if (!diskStore.exists(abs)) return;
    if (diskStore.isDir(abs)) for (const name of diskStore.list(abs)) visit(join(rel, name));
    else out[rel.split(sep).join("/")] = diskStore.read(abs);
  };
  for (const p of SNAPSHOT) visit(p);
  return out;
}

export interface Problems {
  errors: string[];
  warnings: string[];
}

/** Every planning check, and the story maps' own checks, as lines. Run against the store in use. */
export function checkRepo(root: string): Problems {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const i of planningIssues(root)) (i.warning ? warnings : errors).push(`${i.file}: ${i.message}`);
  // intent/ with no maps/ still gets validateGroup's migrate hint.
  if (mapDirs(root).length || store().isDir(join(root, "intent"))) {
    for (const i of validateGroup(root).errors) errors.push(`${i.file}: ${i.message}`);
  }
  return { errors, warnings };
}

/** Run an op against the store in use, recording the paths it wrote (relative to root). */
function recorded<T>(root: string, fn: () => T): { value: T; changed: string[] } {
  const base = store();
  const written = new Set<string>();
  const note = (p: string) => written.add(resolve(p));
  const wrapped: Store = {
    read: (p) => base.read(p),
    exists: (p) => base.exists(p),
    isDir: (p) => base.isDir(p),
    list: (d) => base.list(d),
    write: (p, text, o) => {
      base.write(p, text, o);
      note(p);
    },
    append: (p, text) => {
      base.append(p, text);
      note(p);
    },
    remove: (p) => {
      base.remove(p);
      note(p);
    },
    memory: base.memory,
  };
  const value = withStore(wrapped, fn);
  return { value, changed: [...written].sort().map((p) => relative(root, p).split(sep).join("/")) };
}

/**
 * Refuse an op before anything is written: the checks, then a strict dry run on the in-memory copy.
 * Throws the message runOp would throw. The server calls this before it creates a branch, so a
 * refused save leaves the repo where it was.
 */
export function vetOp(root: string, op: Op): void {
  const abs = resolve(root);
  precheck(abs, op);
  const dry = runOps(abs, [op]);
  if (!dry.results[0].ok) {
    const stale = dry.results[0].skipped;
    if (stale !== undefined) throw new StaleError("", stale);
    throw new Error(dry.results[0].message);
  }
  const fresh = dry.validation.errors.find((e) => !dry.baseline.errors.includes(e));
  if (fresh) throw new Error(fresh.replace(/^[^:]*: /, ""));
}

/**
 * Apply one op to the repo on disk. Throws the message the command gives, unchanged. With strict,
 * the op is first tried on an in-memory copy and refused if it adds a validation error, so a
 * write that the checks would fail is never made.
 */
export function runOp(root: string, op: Op, opts: { strict?: boolean } = {}): { message: string; changed: string[] } {
  const abs = resolve(root);
  if (opts.strict) vetOp(abs, op);
  else precheck(abs, op);
  const { value, changed } = recorded(abs, () => apply(abs, op));
  return { message: value, changed };
}

export interface OpResult {
  index: number;
  ok: boolean;
  message: string;
  /** Set when the op was not applied because the file moved on since it was loaded. */
  skipped?: string;
}

/**
 * Dry run: each op in order against an in-memory copy of the repo's files. Nothing is written to
 * disk. A stale op is skipped with its reason, and the others still run.
 *
 * With chain, an op's expect may also be a hash the file had earlier in this same run (the change
 * file's rule: two ops on one file, the second made against the first's result). Each hash the run
 * has seen maps back to its file, and the expect is moved on to the file's current hash.
 */
export function runOps(root: string, ops: Op[], opts: { chain?: boolean } = {}): { results: OpResult[]; changes: Map<string, string>; removed: string[]; validation: Problems; baseline: Problems } {
  const abs = resolve(root);
  const files = snapshotFiles(abs);
  const mem = new MemoryStore(files, abs);
  const seen = new Map<string, string>();
  if (opts.chain) for (const [rel, text] of Object.entries(files)) seen.set(hash(text), rel);
  const results: OpResult[] = [];
  const { baseline, validation } = withStore(mem, () => {
    const before = checkRepo(abs);
    ops.forEach((op, index) => {
      if (EDITS.has(op.op) && !op.expect) {
        results.push({ index, ok: false, message: `${op.op} needs the expect the snapshot gave: export again` });
        return;
      }
      let next = op;
      if (opts.chain && op.expect !== undefined && seen.has(op.expect)) {
        const file = join(abs, seen.get(op.expect)!);
        if (mem.exists(file)) next = { ...op, expect: hash(mem.read(file)) };
      }
      try {
        precheck(abs, next);
        results.push({ index, ok: true, message: apply(abs, next) });
      } catch (err) {
        const message = (err as Error).message.split("\n")[0];
        results.push({ index, ok: false, message, ...(err instanceof StaleError ? { skipped: message } : {}) });
      }
      if (opts.chain) for (const c of mem.changes()) seen.set(hash(c.text), c.path);
    });
    return { baseline: before, validation: checkRepo(abs) };
  });
  return { results, changes: new Map(mem.changes().map((c) => [c.path, c.text])), removed: mem.deletions(), validation, baseline };
}
