// The levels a plan can be at, and what each may hold. OKRs stop at department level: company
// and department plans set objectives and key results, and group plans only make bets. A key
// result or bet aligns to a plan above it that the owner joins (a group may join several), and can
// name several things there. Team plans (a plan.yaml with level team) are going away, so one still
// loads, with a warning.
import { join } from "node:path";
import { CROSS_REF } from "../lib/bets.js";
import { store } from "../lib/store.js";
import { areaOf, betIds, krIds, loadBet, loadKr, loadPlan, paths, validatePlanning, type PlanningIssue } from "./model.js";
import { areaAlignmentProblems, areaKrTargetProblems } from "../plan/repo.js";
import { upstreamEntries } from "./upstream.js";

/** How high a level sits: a plan may align only to one with a lower rank. Teams are the lowest. */
const RANK: Record<string, number> = { company: 0, department: 1, group: 2, team: 3 };

/** aligns_to as a list: it may be one reference or several. */
export const alignsList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? [v] : []);

/** One reference, or a list for several, as the files hold them. */
export const alignsValue = (refs: string[]) => (refs.length === 1 ? refs[0] : refs);

/** The plan's level from planning/plan.yaml, or undefined for a repo with none. */
export const levelOf = (root: string): string | undefined => {
  // In a planning repo, the folder is the level.
  const area = areaOf(root);
  if (area) return area.level;
  const level = loadPlan(root)?.level;
  return typeof level === "string" ? level : undefined;
};

const NO_OKRS = "Key results stop at department level, so a group plan has none. Move it to the department's plan, or make it a bet aimed at a department key result (krs: <department repo>#<kr-id>).";

/** Why a key result can't be written at this level, or nothing. A group has none; a legacy team plan keeps its old behaviour. */
export function krLevelProblem(level: string | undefined): string | undefined {
  return level === "group" ? NO_OKRS : undefined;
}

/** A 0.3.0 team plan (a plan.yaml that says level team): its links are left as they were, until it's migrated. */
const legacyTeam = (root: string) => loadPlan(root)?.level === "team";

/** The repos of the plans this one joins (planning/upstream.yaml), or none when it can't be read. */
function joinedRepos(root: string): string[] {
  try {
    return upstreamEntries(root).map((e) => e.repo);
  } catch {
    // A broken upstream.yaml is reported by validate on its own.
    return [];
  }
}

/** The level of a joined plan's synced copy, if it has been synced. */
function copyOf(root: string, repo: string): { copy: string; level?: string } | undefined {
  const copy = join(paths(root).cache, ...repo.split("/"));
  if (!store().isDir(join(copy, "planning"))) return undefined;
  return { copy, level: levelOf(copy) };
}

/**
 * What's wrong with a key result's or bet's aligns_to: each reference must name a plan this one
 * joins, ranked above it, and the same kind of thing in it. A plan that isn't synced yet can't be
 * checked further; `nikos planning validate` reports it as unresolved.
 */
export function alignmentProblems(root: string, refs: string[], kind: "kr" | "bet", level = levelOf(root)): string[] {
  if (!refs.length) return [];
  const area = areaOf(root);
  if (area) return areaAlignmentProblems(area, refs, kind);
  const noun = kind === "kr" ? "key result" : "bet";
  if (level === "company") return [`A company ${noun} has no plan above it to align to`];
  const above = joinedRepos(root);
  const out: string[] = [];
  for (const ref of refs) {
    if (!CROSS_REF.test(ref)) {
      out.push(`'${ref}' isn't another plan's ${noun}: write it as <repo>#<id>, e.g. acme/company-plan#${kind === "kr" ? "kr-1" : "one-tap-pay"}`);
      continue;
    }
    const [repo, id] = ref.split("#");
    if (!level || legacyTeam(root)) continue;
    if (!above.includes(repo)) {
      out.push(`${ref}: ${repo} isn't a plan this ${level} joins (planning/upstream.yaml lists ${above.length ? above.join(", ") : "none"})`);
      continue;
    }
    const found = copyOf(root, repo);
    if (!found) continue;
    if (found.level && RANK[found.level] !== undefined && RANK[found.level] >= RANK[level]) {
      out.push(`${ref}: ${repo} is a ${found.level} plan, and a ${level} ${noun} can only align to a plan above ${level}`);
    }
    const isKr = krIds(found.copy).includes(id);
    const isBet = betIds(found.copy).includes(id);
    if (kind === "kr" && !isKr && isBet) out.push(`${ref} is a bet: a key result aligns to key results`);
    else if (kind === "bet" && !isBet && isKr) out.push(`${ref} is a key result: a bet aligns to bets, and names key results under krs`);
    else if (kind === "kr" ? !isKr : !isBet) out.push(`${ref} isn't a ${noun} in ${repo}: check the id, and run nikos planning sync if it was just added`);
  }
  return out;
}

/**
 * What's wrong with a bet's krs that name another plan's key results: each must be a key result in
 * a plan this one joins, ranked above it. A key result of a group plan gets the group wording.
 */
export function krTargetProblems(root: string, refs: string[], level = levelOf(root)): string[] {
  const area = areaOf(root);
  if (area) return areaKrTargetProblems(area, refs);
  if (legacyTeam(root)) return [];
  const above = joinedRepos(root);
  const out: string[] = [];
  for (const ref of refs.filter((r) => CROSS_REF.test(r))) {
    const [repo, id] = ref.split("#");
    if (!above.includes(repo)) {
      out.push(`${ref}: ${repo} isn't a plan this ${level ?? "plan"} joins (planning/upstream.yaml lists ${above.length ? above.join(", ") : "none"})`);
      continue;
    }
    const found = copyOf(root, repo);
    if (!found) continue;
    if (found.level && level && RANK[found.level] !== undefined && RANK[found.level] >= RANK[level]) {
      out.push(`${ref}: ${repo} is a ${found.level} plan, and a ${level} bet can only aim at key results above ${level}`);
    }
    const isKr = krIds(found.copy).includes(id);
    if (isKr && found.level === "group") out.push(NO_OKRS);
    else if (!isKr && betIds(found.copy).includes(id)) out.push(`${ref} is a bet: krs names key results, and a bet aligns to bets`);
    else if (!isKr) out.push(`${ref} isn't a key result in ${repo}: check the id, and run nikos planning sync if it was just added`);
  }
  return out;
}

/** The rules each level follows, as issues. Warnings don't fail validation. */
export function levelIssues(root: string): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  // An area of a planning repo: its own file and key results are checked with the repo (repoIssues), and its links here.
  const area = areaOf(root);
  if (area) {
    for (const id of krIds(root)) {
      try {
        const kr = loadKr(root, id);
        for (const m of areaAlignmentProblems(area, alignsList(kr.data?.aligns_to), "kr")) issues.push({ file: kr.file, message: m });
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
  const plan = loadPlan(root);
  const level = levelOf(root);
  // A plan.yaml that says level team is the old team plan, kept loading with warnings.
  const team = plan?.level === "team";
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
    const krs = bet.meta?.krs ?? {};
    for (const m of krTargetProblems(root, [krs.primary, ...alignsList(krs.also)].filter((r): r is string => typeof r === "string"), level)) issues.push({ file: bet.file, message: m });
  }
  return issues;
}

/** Every planning issue: each file against its schema, then the level rules. */
export function planningIssues(root: string): PlanningIssue[] {
  return [...validatePlanning(root), ...levelIssues(root)];
}
