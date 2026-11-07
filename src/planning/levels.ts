// The levels a plan can be at, and what each may hold. OKRs stop at department level: company
// and department plans set objectives and key results, and group plans only make bets. A key
// result or bet aligns to the plan directly above it (department to company, group to
// department), and can name several things there. Team plans are going away, since teams are
// assigned story maps by their group, so one still loads, with a warning.
import { join } from "node:path";
import { CROSS_REF } from "../lib/bets.js";
import { store } from "../lib/store.js";
import { betIds, krIds, loadBet, loadKr, loadPlan, paths, validatePlanning, type PlanningIssue } from "./model.js";
import { upstreamEntries } from "./upstream.js";

/** The level each one aligns to. */
const ABOVE: Record<string, string> = { department: "company", group: "department" };

/** aligns_to as a list: it may be one reference or several. */
export const alignsList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? [v] : []);

/** One reference, or a list for several, as the files hold them. */
export const alignsValue = (refs: string[]) => (refs.length === 1 ? refs[0] : refs);

export const levelOf = (root: string): string | undefined => {
  const level = loadPlan(root)?.level;
  return typeof level === "string" ? level : undefined;
};

const NO_OKRS = "Key results stop at department level, so a group plan has none. Move it to the department's plan, or make it a bet aimed at a department key result (krs: <department repo>#<kr-id>).";

/** Why a key result can't be written at this level, or nothing. */
export function krLevelProblem(level: string | undefined): string | undefined {
  return level === "group" ? NO_OKRS : undefined;
}

/**
 * What's wrong with a key result's or bet's aligns_to: each reference must name the plan
 * directly above this one, and the same kind of thing in it. A plan that isn't synced yet can't
 * be checked further; `nikos planning validate` reports it as unresolved.
 */
export function alignmentProblems(root: string, refs: string[], kind: "kr" | "bet", level = levelOf(root)): string[] {
  if (!refs.length) return [];
  const noun = kind === "kr" ? "key result" : "bet";
  if (level === "company") return [`A company ${noun} has no plan above it to align to`];
  let above: string[] = [];
  try {
    above = upstreamEntries(root).map((e) => e.repo);
  } catch {
    // A broken upstream.yaml is reported by validate on its own.
  }
  const out: string[] = [];
  for (const ref of refs) {
    if (!CROSS_REF.test(ref)) {
      out.push(`'${ref}' isn't another plan's ${noun}: write it as <repo>#<id>, e.g. acme/company-plan#${kind === "kr" ? "kr-1" : "one-tap-pay"}`);
      continue;
    }
    const [repo, id] = ref.split("#");
    // Team plans are going away; their links are left as they are until they're migrated.
    if (!level || level === "team") continue;
    if (!above.includes(repo)) {
      out.push(`${ref}: ${repo} isn't the plan directly above this one (planning/upstream.yaml lists ${above.length ? above.join(", ") : "none"})`);
      continue;
    }
    const copy = join(paths(root).cache, ...repo.split("/"));
    if (!store().isDir(join(copy, "planning"))) continue;
    const upLevel = levelOf(copy);
    if (upLevel && ABOVE[level] && upLevel !== ABOVE[level]) out.push(`${ref}: ${repo} is a ${upLevel} plan, and a ${level} ${noun} aligns to the ${ABOVE[level]} plan`);
    const isKr = krIds(copy).includes(id);
    const isBet = betIds(copy).includes(id);
    if (kind === "kr" && !isKr && isBet) out.push(`${ref} is a bet: a key result aligns to key results`);
    if (kind === "bet" && !isBet && isKr) out.push(`${ref} is a key result: a bet aligns to bets, and names key results under krs`);
  }
  return out;
}

/** The rules each level follows, as issues. Warnings don't fail validation. */
export function levelIssues(root: string): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  const plan = loadPlan(root);
  const level = levelOf(root);
  const team = level === "team";
  if (team) {
    issues.push({
      file: "planning/plan.yaml",
      warning: true,
      message: "Team plans are going away: teams are assigned story maps by their group. Keep this team's key results and bets in the department's or group's plan.",
    });
  }
  if ((level === "group" || team) && plan?.objectives?.length) {
    issues.push({ file: "planning/plan.yaml", ...(team ? { warning: true } : {}), message: `A ${level} plan has no objectives: OKRs stop at department level. Aim its bets at the department's key results instead.` });
  }
  for (const id of krIds(root)) {
    let kr;
    try {
      kr = loadKr(root, id);
    } catch {
      continue; // reported by validatePlanning
    }
    if (level === "group" || team) issues.push({ file: kr.file, ...(team ? { warning: true } : {}), message: NO_OKRS.replace("a group plan", `a ${level} plan`) });
    for (const m of alignmentProblems(root, alignsList(kr.data?.aligns_to), "kr", level)) issues.push({ file: kr.file, message: m });
  }
  for (const id of betIds(root)) {
    let bet;
    try {
      bet = loadBet(root, id);
    } catch {
      continue;
    }
    for (const m of alignmentProblems(root, alignsList(bet.meta?.aligns_to), "bet", level)) issues.push({ file: bet.file, message: m });
  }
  return issues;
}

/** Every planning issue: each file against its schema, then the level rules. */
export function planningIssues(root: string): PlanningIssue[] {
  return [...validatePlanning(root), ...levelIssues(root)];
}
