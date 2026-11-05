// Key results in planning/krs/<id>.yaml: a baseline, a target and a date, and dated
// check-ins that are only ever added to. Revising the target keeps the original.
import { join } from "node:path";
import { BET_ID } from "../lib/bets.js";
import { DATE, checkKr, describeErrors, krText, loadKr, paths, today, writePlanning } from "./model.js";

export interface KrInput {
  id: string;
  title: string;
  owner: string;
  baseline: number;
  target: number;
  by: string;
  unit?: string;
  objective?: string;
  alignsTo?: string;
  staleAfterDays?: number;
}

function checked(data: any): any {
  if (!checkKr(data)) throw new Error(`Not a valid key result: ${describeErrors(checkKr.errors).join("; ")}`);
  return data;
}

export function newKr(input: KrInput, root: string): string {
  if (!BET_ID.test(input.id)) throw new Error(`'${input.id}' is not a key result id (lowercase words joined by hyphens)`);
  if (!input.title?.trim()) throw new Error("A key result needs a title (--title)");
  if (!input.owner?.trim()) throw new Error("A key result needs an owner (--owner)");
  if (!Number.isFinite(input.baseline) || !Number.isFinite(input.target)) throw new Error("A key result needs a numeric --baseline and --target");
  if (!DATE.test(input.by ?? "")) throw new Error("A key result needs a date (--by YYYY-MM-DD)");
  const data = checked({
    id: input.id,
    title: input.title.trim(),
    ...(input.objective ? { objective: input.objective } : {}),
    owner: input.owner.trim(),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    baseline: input.baseline,
    target: input.target,
    original_target: input.target,
    by: input.by,
    ...(input.alignsTo ? { aligns_to: input.alignsTo } : {}),
    ...(input.staleAfterDays ? { stale_after_days: input.staleAfterDays } : {}),
    checkins: [],
  });
  return writePlanning(root, join(paths(root).krs, `${input.id}.yaml`), krText(data), { create: true });
}

/** Add a dated check-in. Earlier check-ins are never changed. */
export function checkIn(
  root: string,
  id: string,
  c: { value: number; note?: string; evidence?: string; date?: string; expect?: string },
): string {
  if (!Number.isFinite(c.value)) throw new Error("A check-in needs a numeric value");
  const kr = loadKr(root, id);
  const data = structuredClone(kr.data);
  data.checkins = [
    ...(data.checkins ?? []),
    { date: c.date ?? today(), value: c.value, ...(c.note?.trim() ? { note: c.note.trim() } : {}), ...(c.evidence?.trim() ? { evidence: c.evidence.trim() } : {}) },
  ];
  return writePlanning(root, join(paths(root).krs, `${id}.yaml`), krText(checked(data)), { expect: c.expect ?? kr.hash });
}

/** Move the target. The original target stays recorded. */
export function reviseTarget(root: string, id: string, target: number, expect?: string): string {
  if (!Number.isFinite(target)) throw new Error("A target is a number");
  const kr = loadKr(root, id);
  const data = structuredClone(kr.data);
  data.original_target ??= data.target;
  data.target = target;
  return writePlanning(root, join(paths(root).krs, `${id}.yaml`), krText(checked(data)), { expect: expect ?? kr.hash });
}

export const latest = (kr: any) => (kr.checkins?.length ? kr.checkins[kr.checkins.length - 1] : undefined);

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Stale when the last check-in (or, with none, nothing at all) is older than stale_after_days (default 14). */
export function isStale(kr: any, on = today()): boolean {
  const last = latest(kr);
  if (!last) return true;
  return days(last.date, on) > (kr.stale_after_days ?? 14);
}

/** Progress from baseline toward target, 0..1 (can pass 1). Works for targets below the baseline too. */
export function progress(kr: any): number {
  const v = latest(kr)?.value ?? kr.baseline;
  return kr.target === kr.baseline ? 1 : (v - kr.baseline) / (kr.target - kr.baseline);
}
