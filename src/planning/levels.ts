// The rules a planning area follows: its level (company, department, group or team), and what its key
// results and bets may align to. A key result or bet aligns to one in another area of the same company,
// ranked above it, and names the id there. Key results stop at department level (plan/repo.ts).
import { areaOf, betIds, krIds, loadBet, loadKr, validatePlanning, type PlanningIssue } from "./model.js";
import { areaAlignmentProblems, areaKrTargetProblems } from "../plan/repo.js";

/** aligns_to as a list: it may be one reference or several. */
export const alignsList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? [v] : []);

/** One reference, or a list for several, as the files hold them. */
export const alignsValue = (refs: string[]) => (refs.length === 1 ? refs[0] : refs);

/** The level of the planning area at root, or undefined outside one. */
export const levelOf = (root: string): string | undefined => areaOf(root)?.level;

/** What's wrong with a key result's or bet's aligns_to in the area at root. Nothing outside an area. */
export function alignmentProblems(root: string, refs: string[], kind: "kr" | "bet"): string[] {
  const area = areaOf(root);
  return area && refs.length ? areaAlignmentProblems(area, refs, kind) : [];
}

/** What's wrong with a bet's krs in the area at root. Nothing outside an area. */
export function krTargetProblems(root: string, refs: string[]): string[] {
  const area = areaOf(root);
  return area ? areaKrTargetProblems(area, refs) : [];
}

/** A direction that points against the target's side: 'down' with the target above the baseline. A warning, since a figure may still be right. */
export function directionProblem(kr: any): string | undefined {
  if (kr.target === kr.baseline || typeof kr.target !== "number" || typeof kr.baseline !== "number") return undefined;
  const above = kr.target > kr.baseline;
  if (kr.direction === "down" && above) return `direction is down, but the target ${kr.target} is above the baseline ${kr.baseline}`;
  if (kr.direction !== "down" && !above) return `direction is up, but the target ${kr.target} is below the baseline ${kr.baseline}`;
  return undefined;
}

/** The rules each area follows, as issues. Warnings don't fail validation. */
export function levelIssues(root: string): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  const area = areaOf(root);
  if (!area) return issues;
  // The area's own file and key results are checked with the repo (repoIssues); its links are checked here.
  for (const id of krIds(root)) {
    try {
      const kr = loadKr(root, id);
      for (const m of areaAlignmentProblems(area, alignsList(kr.data?.aligns_to), "kr")) issues.push({ file: kr.file, message: m });
      const direction = directionProblem(kr.data ?? {});
      if (direction) issues.push({ file: kr.file, message: direction, warning: true });
    } catch {
      // reported by validatePlanning
    }
  }
  for (const id of betIds(root)) {
    try {
      const bet = loadBet(root, id);
      const krs = bet.meta?.krs ?? {};
      for (const m of areaAlignmentProblems(area, alignsList(bet.meta?.aligns_to), "bet")) issues.push({ file: bet.file, message: m });
      for (const m of areaKrTargetProblems(area, [krs.primary, ...alignsList(krs.also)].filter((r): r is string => typeof r === "string"))) issues.push({ file: bet.file, message: m });
    } catch {
      // reported by validatePlanning
    }
  }
  return issues;
}

/** Every planning issue: each file against its schema, then the area rules. */
export function planningIssues(root: string): PlanningIssue[] {
  return [...validatePlanning(root), ...levelIssues(root)];
}
