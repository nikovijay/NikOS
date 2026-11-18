// Key results in planning/krs/<id>.yaml: a baseline, a target and a date, and dated
// check-ins that are only ever added to. Revising the target keeps the original.
import { join } from "node:path";
import { BET_ID } from "../lib/bets.js";
import { areaOf, checkKr, describeErrors, krText, loadKr, paths, today, writePlanning } from "./model.js";
import { companyYear, krAreaProblem, newIdFor, objectiveIds, periodEnd, periodProblem, takenProblem } from "../plan/repo.js";
import { dateProblem, krFieldProblems } from "./rules.js";
import { alignmentProblems, alignsValue } from "./levels.js";

export interface KrInput {
  /** The key result's id. Without it, the id is made from the title (see newIdFor). */
  id?: string;
  title: string;
  owner: string;
  baseline: number;
  target: number;
  by: string;
  /** In a planning repo: the company's year, or a department's quarter (2027-Q1). */
  period?: string;
  unit?: string;
  objective?: string;
  /** Which way the figure should move: up unless down. Only down is written; up is the default. */
  direction?: "up" | "down";
  /** number (the default) is a figure toward a target. milestone is a list of steps, given by steps. */
  kind?: "number" | "milestone";
  /** A milestone's steps, in order: their names. Set at creation only. */
  steps?: string[];
  /** The key results in the plan directly above that this one aligns to: one or several. */
  alignsTo?: string | string[];
  /** Free text: what this ladders up to, until a link is written. Not with alignsTo. */
  laddersUp?: string;
  staleAfterDays?: number;
}

const NO_ABOVE_KR = "A company key result has nothing above it to align to, so it has no ladders_up";

function checked(data: any): any {
  if (!checkKr(data)) throw new Error(`Not a valid key result: ${describeErrors(checkKr.errors).join("; ")}`);
  return data;
}

/**
 * Write planning/krs/<id>.yaml. With no id, the id is made from the title, with -2 or -3 when another key result
 * or bet in the company has it. An id given is used as it is.
 */
const report = (problems: string[]) => {
  const unique = [...new Set(problems)];
  if (unique.length) throw new Error(unique.join("\n"));
};

export function newKr(input: KrInput, root: string): string {
  const area = areaOf(root);
  const given = input.id?.trim() || undefined;
  const missing: string[] = [];
  if (!input.title?.trim()) missing.push("A key result needs a title");
  if (!input.owner?.trim()) missing.push("A key result needs an owner");
  if (input.kind !== undefined && input.kind !== "number" && input.kind !== "milestone") missing.push("kind is number or milestone");
  // A milestone has steps instead of a baseline and a target. Its steps are fixed here: kr step marks them, and nothing adds one later.
  const milestone = input.kind === "milestone";
  const names = (input.steps ?? []).map((s) => s.trim());
  if (milestone) {
    if (Number.isFinite(input.baseline) || Number.isFinite(input.target)) missing.push("A milestone has no baseline or target: its steps are its progress");
    if (input.direction) missing.push("A milestone has no direction: each step is done or not");
    if (!names.length || names.some((s) => !s)) missing.push("A milestone needs at least one step");
    if (new Set(names).size !== names.length) missing.push("Each step of a milestone needs its own name");
  } else {
    if (!Number.isFinite(input.baseline) || !Number.isFinite(input.target)) missing.push("A key result needs a starting number and a target number");
    if (names.length) missing.push("Only a milestone has steps: set the kind to milestone");
  }
  // In a planning repo a key result is for a period: the company's year, or a department's quarter. Its date defaults to the period's end.
  const period = input.period ?? (area?.level === "company" ? companyYear(area.repo) : undefined);
  if (area) {
    const problem = periodProblem(area, period);
    if (problem) missing.push(problem);
  }
  const by = input.by || (period ? periodEnd(period) ?? "" : "");
  if (!by) missing.push("A key result needs a due date (YYYY-MM-DD)");
  else if (dateProblem(by)) missing.push(`The due date ${dateProblem(by)}`);
  const objective = input.objective?.trim();
  if (objective && area && !objectiveIds(area).includes(objective)) {
    const where = area.level === "company" ? "company" : area.id;
    missing.push(`There's no objective '${objective}' in ${area.rel}. Add it with nikos plan objective add ${objective} --title "<title>" --in ${where}`);
  }
  report(missing);
  const id = given ?? newIdFor(area?.repo, input.title.trim());
  if (!id) throw new Error(`'${input.title.trim()}' has no letters or numbers to make an id from: use a title with some letters or numbers, or give an id`);
  if (!BET_ID.test(id)) throw new Error(`'${id}' is not a key result id (lowercase words joined by hyphens)`);
  if (area) {
    const refused = krAreaProblem(area) ?? takenProblem(area.repo, id);
    if (refused) throw new Error(refused);
  }
  input = { ...input, by };
  const direction = krFieldProblems({ direction: input.direction }, "edit")[0];
  if (direction) throw new Error(direction);
  const aligns = [...new Set([input.alignsTo ?? []].flat().filter(Boolean))];
  const problem = alignmentProblems(root, aligns, "kr")[0];
  if (problem) throw new Error(problem);
  const ladders = input.laddersUp?.trim() || undefined;
  const laddersProblemText = krFieldProblems({ ladders_up: ladders }, "edit")[0];
  if (laddersProblemText) throw new Error(laddersProblemText);
  if (ladders && area?.level === "company") throw new Error(NO_ABOVE_KR);
  if (ladders && aligns.length) throw new Error("Give a link (--aligns-to) or the text (--ladders-up), not both");
  const data = checked({
    id,
    title: input.title.trim(),
    ...(input.objective ? { objective: input.objective } : {}),
    owner: input.owner.trim(),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    ...(milestone
      ? { kind: "milestone", steps: names.map((name) => ({ name })) }
      : { ...(input.direction === "down" ? { direction: "down" } : {}), baseline: input.baseline, target: input.target, original_target: input.target }),
    by: input.by,
    ...(period ? { period } : {}),
    ...(aligns.length ? { aligns_to: alignsValue(aligns) } : {}),
    ...(ladders ? { ladders_up: ladders } : {}),
    ...(input.staleAfterDays ? { stale_after_days: input.staleAfterDays } : {}),
    checkins: [],
  });
  return writePlanning(root, join(paths(root).krs, `${id}.yaml`), krText(data), { create: true });
}

/** Add a dated check-in. Earlier check-ins are never changed. */
export function checkIn(
  root: string,
  id: string,
  c: { value: number; note?: string; evidence?: string; date?: string; expect?: string },
): string {
  if (!Number.isFinite(c.value)) throw new Error("A check-in needs a numeric value");
  if (c.date !== undefined && dateProblem(c.date)) throw new Error("The check-in date is not a date (YYYY-MM-DD)");
  const kr = loadKr(root, id);
  if (kindOf(kr.data) === "milestone") throw new Error(`${id} is a milestone, so it has steps, not a value: mark one with nikos plan kr step ${id} "<step>"`);
  const data = structuredClone(kr.data);
  const entry = { date: c.date ?? today(), value: c.value, ...(c.note?.trim() ? { note: c.note.trim() } : {}), ...(c.evidence?.trim() ? { evidence: c.evidence.trim() } : {}) };
  // A back-dated check-in goes in date order, after any on the same day, so the file reads oldest first.
  const list = [...(data.checkins ?? [])];
  const at = list.findIndex((x: any) => String(x.date) > entry.date);
  list.splice(at === -1 ? list.length : at, 0, entry);
  data.checkins = list;
  return writePlanning(root, join(paths(root).krs, `${id}.yaml`), krText(checked(data)), { expect: c.expect ?? kr.hash });
}

/** Move the target. The original target stays recorded. */
export function reviseTarget(root: string, id: string, target: number, expect?: string): string {
  if (!Number.isFinite(target)) throw new Error("A target is a number");
  const kr = loadKr(root, id);
  if (kindOf(kr.data) === "milestone") throw new Error(`${id} is a milestone, so it has no target to move`);
  const data = structuredClone(kr.data);
  data.original_target ??= data.target;
  data.target = target;
  return writePlanning(root, join(paths(root).krs, `${id}.yaml`), krText(checked(data)), { expect: expect ?? kr.hash });
}

/** Change a key result's fields. An empty optional field (or null) deletes it. Baseline and target aren't here: kr target moves the target. */
export function editKr(root: string, id: string, fields: Record<string, unknown>, expect?: string): string {
  const problem = krFieldProblems(fields, "edit")[0];
  if (problem) throw new Error(problem);
  if (typeof fields.ladders_up === "string" && fields.ladders_up.trim() && areaOf(root)?.level === "company") throw new Error(NO_ABOVE_KR);
  const kr = loadKr(root, id);
  // A milestone has no direction, the same as newKr refuses it. A blank value is nothing to set, so it passes.
  if (kindOf(kr.data) === "milestone" && fields.direction !== undefined && fields.direction !== null && fields.direction !== "") {
    throw new Error("A milestone has no direction: each step is done or not");
  }
  const data = structuredClone(kr.data);
  for (const [k, raw] of Object.entries(fields)) {
    const v = k === "ladders_up" && typeof raw === "string" ? raw.trim() : raw;
    // up is the default, so it is not written: only down is.
    if (v === "" || v === null || v === undefined || (k === "direction" && v === "up")) delete data[k];
    else data[k] = typeof v === "string" && (k === "title" || k === "owner" || k === "unit" || k === "objective") ? v.trim() : v;
  }
  const area = areaOf(root);
  if (typeof data.objective === "string" && data.objective && area && !objectiveIds(area).includes(data.objective)) {
    const where = area.level === "company" ? "company" : area.id;
    throw new Error(`There's no objective '${data.objective}' in ${area.rel}. Add it with nikos plan objective add ${data.objective} --title "<title>" --in ${where}`);
  }
  return writePlanning(root, join(paths(root).krs, `${id}.yaml`), krText(checked(data)), { expect: expect ?? kr.hash });
}

/** The newest check-in by date; of two on the same day, the one written later. A hand-edited file may be out of order. */
export const latest = (kr: any) =>
  (kr.checkins ?? []).reduce((best: any, c: any) => (best === undefined || String(c.date) >= String(best.date) ? c : best), undefined);

/** A key result's kind: number unless its file says milestone. */
export const kindOf = (kr: any): "number" | "milestone" => (kr.kind === "milestone" ? "milestone" : "number");

/** How many of a milestone's steps are done. */
export const stepsDone = (kr: any): number => (kr.steps ?? []).filter((s: any) => s.done).length;

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** The first day of a period: 2027 is 2027-01-01, 2027-Q2 is 2027-04-01. */
function periodStart(period: string): string | undefined {
  if (/^\d{4}$/.test(period)) return `${period}-01-01`;
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!q) return undefined;
  return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
}

const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Stale. A number is stale when its last check-in is older than stale_after_days (default 14). With no
 * check-in it isn't stale until the period has started and the first check-in is due (that many days
 * after the period starts). A milestone is stale when its latest step done is that old. With no step
 * done it isn't stale: nothing has started, so there is nothing to go stale.
 */
export function isStale(kr: any, on = today()): boolean {
  const start = typeof kr.period === "string" ? periodStart(kr.period) : undefined;
  if (kindOf(kr) === "milestone") {
    const done = (kr.steps ?? []).map((s: any) => s.done).filter(Boolean);
    // Every step done: nothing is waiting, so nothing is going stale.
    if (done.length === (kr.steps ?? []).length) return false;
    const newest = done.sort().pop();
    return !!newest && days(newest, on) > (kr.stale_after_days ?? 14);
  }
  const last = latest(kr);
  const window = kr.stale_after_days ?? 14;
  // Nothing has been checked in. The first check-in is due `window` days after the period starts.
  if (!last) return !(start && on < plusDays(start, window));
  return days(last.date, on) > window;
}

/** Which way a key result should move. Up unless its file says down. */
export const directionOf = (kr: any): "up" | "down" => (kr.direction === "down" ? "down" : "up");

/**
 * Progress from baseline toward target: 0 at the baseline, 1 at the target, and past 1 when it
 * overshoots. It works the same for a figure that should go down (11 toward 7, at 9 is 0.5). A value
 * on the wrong side of the baseline gives a negative number: the figure moved the wrong way.
 * A milestone's progress is the share of its steps done.
 */
export function progress(kr: any): number {
  if (kindOf(kr) === "milestone") return stepsDone(kr) / kr.steps.length;
  const v = latest(kr)?.value ?? kr.baseline;
  // The + 0 turns a -0 (no movement, on a figure that goes down) into 0.
  return kr.target === kr.baseline ? 1 : (v - kr.baseline) / (kr.target - kr.baseline) + 0;
}

/**
 * Mark one step of a milestone done, on a date (today unless given). A step is marked once: its date
 * stays as it was first written. Steps are never added or removed here.
 */
export function markStep(root: string, id: string, name: string, date?: string, expect?: string): string {
  const kr = loadKr(root, id);
  if (kindOf(kr.data) !== "milestone") throw new Error(`${id} is not a milestone: check it in with nikos plan checkin ${id} <value>`);
  if (date !== undefined && dateProblem(date)) throw new Error("The step's date is not a date (YYYY-MM-DD)");
  const data = structuredClone(kr.data);
  const want = name.trim();
  const step = (data.steps ?? []).find((s: any) => s.name === want);
  if (!step) throw new Error(`No step called '${want}' in ${id}. Its steps: ${(data.steps ?? []).map((s: any) => s.name).join(", ")}`);
  if (step.done) throw new Error(`'${want}' is already done (on ${step.done}). A step is marked once`);
  step.done = date ?? today();
  return writePlanning(root, join(paths(root).krs, `${id}.yaml`), krText(checked(data)), { expect: expect ?? kr.hash });
}
