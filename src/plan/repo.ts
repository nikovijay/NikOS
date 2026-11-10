// nikOS Plan: one planning repo per company. Each level is a folder under planning/: company/,
// departments/<id>/, groups/<id>/ and teams/<KEY>/. An area holds plan.yaml (a team has team.yaml
// instead), krs/ and bets/, laid out as a repo's planning/ folder is, so the key result and bet code
// in src/planning works on an area as it does on a repo. Ids are unique within the company, so a
// link inside the repo is just the id. See docs/rfcs/plan-and-spec.md.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
const Ajv2020 = (Ajv2020Module as any).default ?? Ajv2020Module;
import { parse, stringify } from "yaml";
import { BET_ID } from "../lib/bets.js";
import { store } from "../lib/store.js";
import { AREA_FOLDERS, areaOf, betIds, describeErrors, isPlanRepo, krIds, type Area, type AreaLevel, type PlanningIssue } from "../planning/model.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = [join(here, "../../schemas/planning"), join(here, "../schemas/planning")].find((d) => existsSync(d))!;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const checkArea = ajv.compile(JSON.parse(readFileSync(join(schemaDir, "area.schema.json"), "utf8")));
const checkTeam = ajv.compile(JSON.parse(readFileSync(join(schemaDir, "team-area.schema.json"), "utf8")));

/** How high a level sits: a key result or bet aligns only to one ranked above it. */
export const RANK: Record<AreaLevel, number> = { company: 0, department: 1, group: 2, team: 3 };
const FOLDER: Record<Exclude<AreaLevel, "company">, keyof typeof AREA_FOLDERS> = { department: "departments", group: "groups", team: "teams" };
export const TEAM_KEY = /^[A-Z][A-Z0-9]{0,9}$/;
const YEAR = /^\d{4}$/;
const QUARTER = /^(\d{4})-Q([1-4])$/;

/** The planning repo at or above start, if there is one. */
export function findPlanRepo(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (isPlanRepo(dir)) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** Every area of a planning repo: the company first, then departments, groups and teams. */
export function listAreas(repo: string): Area[] {
  const company = areaOf(join(repo, "planning", "company"));
  const out: Area[] = company ? [company] : [];
  for (const folder of Object.keys(AREA_FOLDERS)) {
    const dir = join(repo, "planning", folder);
    if (!store().isDir(dir)) continue;
    for (const name of store().list(dir).sort()) {
      const area = store().isDir(join(dir, name)) ? areaOf(join(dir, name)) : undefined;
      if (area) out.push(area);
    }
  }
  return out;
}

/** An area's own file: plan.yaml, or team.yaml for a team. Undefined when it's missing or doesn't parse. */
export function areaFile(area: Area): any {
  const path = join(area.dir, area.level === "team" ? "team.yaml" : "plan.yaml");
  if (!store().exists(path)) return undefined;
  try {
    return parse(store().read(path)) ?? {};
  } catch {
    return undefined;
  }
}

/** The company's year (planning/company/plan.yaml period), if it has one. */
export const companyYear = (repo: string): string | undefined => {
  const company = listAreas(repo).find((a) => a.level === "company");
  const period = company && areaFile(company)?.period;
  return typeof period === "string" || typeof period === "number" ? String(period) : undefined;
};

const byId = (repo: string, id: string) => listAreas(repo).find((a) => a.level !== "company" && a.id.toLowerCase() === id.toLowerCase());

/** The area a reference names: company, departments/finance, teams/WEB, or just finance or WEB. */
export function findArea(repo: string, ref: string): Area {
  const clean = ref.replace(/^planning\//, "").replace(/\/+$/, "");
  const areas = listAreas(repo);
  const found = clean.includes("/") ? areas.find((a) => a.rel === clean) : clean === "company" ? areas.find((a) => a.level === "company") : byId(repo, clean);
  if (!found) throw new Error(`There's no area called '${ref}'. The areas are: ${areas.map((a) => a.rel).join(", ")}`);
  return found;
}

/** The area to work in: --in when given, else the area folder you're in, if any. */
export function areaFor(repo: string, ref: string | undefined, cwd: string): Area | undefined {
  if (ref) return findArea(repo, ref);
  let dir = resolve(cwd);
  while (dir.startsWith(repo + sep)) {
    const area = areaOf(dir);
    if (area) return area;
    dir = dirname(dir);
  }
  return undefined;
}

/** The area directly above: a team's home, a group's department (or the company), a department's company. */
export function parentOf(area: Area): Area | undefined {
  if (area.level === "company") return undefined;
  const company = listAreas(area.repo).find((a) => a.level === "company");
  const file = areaFile(area) ?? {};
  const named = area.level === "team" ? file.home : area.level === "group" ? file.department : undefined;
  if (typeof named === "string" && named) {
    const above = byId(area.repo, named);
    if (above && RANK[above.level] < RANK[area.level]) return above;
  }
  return company;
}

/** The chain from the company down to this area, each level once. */
export function chainOf(area: Area): Area[] {
  const out: Area[] = [];
  const seen = new Set<string>();
  for (let a: Area | undefined = area; a && !seen.has(a.rel); a = parentOf(a)) {
    seen.add(a.rel);
    out.unshift(a);
  }
  return out;
}

export interface Entry {
  id: string;
  kind: "key result" | "bet" | "department" | "group" | "team";
  area: Area;
}

/** Every id in the company: each area's own, and its key results and bets. Ids are unique within the company. */
export function companyIds(repo: string): Entry[] {
  const out: Entry[] = [];
  for (const area of listAreas(repo)) {
    if (area.level !== "company") out.push({ id: area.id, kind: area.level, area });
    for (const id of krIds(area.dir)) out.push({ id, kind: "key result", area });
    for (const id of betIds(area.dir)) out.push({ id, kind: "bet", area });
  }
  return out;
}

/** The area that holds a key result or bet, found by its id anywhere in the company. */
export function areaHolding(repo: string, id: string, kind: "key result" | "bet"): Area {
  const hit = companyIds(repo).find((e) => e.kind === kind && e.id === id);
  if (!hit) throw new Error(`No ${kind} called '${id}' in this company's plan. See them all with: nikos plan status`);
  return hit.area;
}

/** Why an id can't be used for something new: it's already used somewhere in the company. */
export function takenProblem(repo: string, id: string): string | undefined {
  const hit = companyIds(repo).find((e) => e.id.toLowerCase() === id.toLowerCase());
  return hit ? `'${id}' is already used: it's ${hit.kind === "key result" ? "a key result" : hit.kind === "bet" ? "a bet" : "the id of"} ${hit.kind === "key result" || hit.kind === "bet" ? `in ${hit.area.rel}` : hit.area.rel}. Ids are unique within the company.` : undefined;
}

const NO_OKRS = (level: AreaLevel) =>
  `Key results stop at department level, so a ${level} has none. Add it to a department or the company, or make it a bet aimed at their key results.`;

/** Why a key result can't be written in this area, or nothing. */
export const krAreaProblem = (area: Area) => (area.level === "group" || area.level === "team" ? NO_OKRS(area.level) : undefined);

/**
 * What's wrong with a key result's period. A company key result is for the company's year, a
 * department's for a quarter inside it.
 */
export function periodProblem(area: Area, period: string | undefined): string | undefined {
  const year = companyYear(area.repo);
  if (area.level === "department") {
    if (!period) return `A department's key result needs a quarter: --period ${year ?? "2027"}-Q1`;
    const q = QUARTER.exec(period);
    if (!q) return `'${period}' isn't a quarter: write it as ${year ?? "2027"}-Q1`;
    if (year && q[1] !== year) return `${period} isn't in the company's year, ${year}`;
    return undefined;
  }
  if (area.level === "company" && period !== undefined && period !== year) return `A company key result is for the company's year${year ? `, ${year}` : ""}, not ${period}`;
  return undefined;
}

/** The last day of a period: 2027 is 2027-12-31, 2027-Q1 is 2027-03-31. */
export function periodEnd(period: string): string | undefined {
  if (YEAR.test(period)) return `${period}-12-31`;
  const q = QUARTER.exec(period);
  if (!q) return undefined;
  const month = Number(q[2]) * 3;
  const day = new Date(Date.UTC(Number(q[1]), month, 0)).getUTCDate();
  return `${q[1]}-${String(month).padStart(2, "0")}-${day}`;
}

const kindOf = (repo: string, id: string) => companyIds(repo).find((e) => e.id === id && (e.kind === "key result" || e.kind === "bet"));

/**
 * What's wrong with an area's aligns_to: each id must be the same kind of thing, in an area ranked
 * above this one. A key result aligns to key results, a bet to bets.
 */
export function areaAlignmentProblems(area: Area, refs: string[], kind: "kr" | "bet"): string[] {
  const noun = kind === "kr" ? "key result" : "bet";
  if (refs.length && area.level === "company") return [`A company ${noun} has nothing above it to align to`];
  const out: string[] = [];
  for (const ref of refs) {
    if (ref.includes("#")) {
      out.push(`In a planning repo, name the ${noun} by its id alone: '${ref.split("#")[1]}', not '${ref}'`);
      continue;
    }
    const hit = kindOf(area.repo, ref);
    if (!hit) out.push(`There's no ${noun} called '${ref}' in this company's plan`);
    else if (hit.kind !== noun) out.push(kind === "kr" ? `${ref} is a bet: a key result aligns to key results` : `${ref} is a key result: a bet aligns to bets, and names key results with --kr`);
    else if (RANK[hit.area.level] >= RANK[area.level]) out.push(`${ref} is in ${hit.area.rel}, which isn't above ${area.rel}: a ${noun} aligns to one at a higher level`);
  }
  return out;
}

/**
 * What's wrong with the key results a bet aims at: each must be a key result at or above the bet's own level.
 * A group's or team's bets aim at department key results only: the company's are for the company's own bets.
 */
export function areaKrTargetProblems(area: Area, refs: string[]): string[] {
  const out: string[] = [];
  const departmentOnly = area.level === "group" || area.level === "team";
  for (const ref of refs) {
    if (ref.includes("#")) {
      out.push(`In a planning repo, name the key result by its id alone: '${ref.split("#")[1]}', not '${ref}'`);
      continue;
    }
    const hit = kindOf(area.repo, ref);
    if (!hit) out.push(`There's no key result called '${ref}' in this company's plan`);
    else if (hit.kind !== "key result") out.push(`${ref} is a bet: --kr names key results, and --aligns-to names bets`);
    else if (RANK[hit.area.level] > RANK[area.level]) out.push(`${ref} is in ${hit.area.rel}, below ${area.rel}: a bet aims at key results at its own level or above`);
    else if (departmentOnly && hit.area.level === "company") out.push(`${ref} is a company key result. A ${area.level}'s bets aim at department key results: name one a department holds`);
  }
  return out;
}

const slug = (id: string) => BET_ID.test(id);
const yaml = (data: unknown) => stringify(data, { lineWidth: 0 });

/** Make a planning repo here: planning/company/ with its plan.yaml. */
export function initPlanRepo(dir: string, input: { name: string; year: string; pillars?: string[]; owner?: string }): string[] {
  const repo = resolve(dir);
  if (isPlanRepo(repo)) throw new Error(`${join(repo, "planning", "company")} already exists: this is already a planning repo`);
  if (store().exists(join(repo, "planning", "plan.yaml"))) throw new Error("This repo has a plan of the old kind (planning/plan.yaml). Make the company's planning repo in a new folder.");
  if (!input.name?.trim()) throw new Error("The company needs a name (--name)");
  if (!YEAR.test(input.year ?? "")) throw new Error(`The company plans by year: give one as --year ${new Date().getUTCFullYear() + 1}`);
  const plan = { name: input.name.trim(), period: input.year, pillars: input.pillars ?? [], ...(input.owner ? { owner: input.owner } : {}) };
  const files = [
    [join(repo, "planning", "company", "plan.yaml"), yaml(plan)],
    [join(repo, "planning", "company", "decisions.md"), `# ${plan.name}: decisions\n`],
  ] as const;
  for (const [path, text] of files) store().write(path, text, { create: true });
  // plan refresh keeps its copies of the code repos under .nikos/, which is never committed.
  const ignore = join(repo, ".gitignore");
  const old = store().exists(ignore) ? store().read(ignore) : "";
  if (!/^\/?\.nikos\/?$/m.test(old)) {
    store().write(ignore, `${old && !old.endsWith("\n") ? `${old}\n` : old}# nikOS plan: the delivery copies from plan refresh\n.nikos/\n`);
    return [...files.map(([p]) => p), ignore];
  }
  return files.map(([p]) => p);
}

/** Add a department, group or team folder. */
export function addArea(
  repo: string,
  level: Exclude<AreaLevel, "company">,
  id: string,
  input: { name: string; owner?: string; members?: string[]; department?: string; home?: string },
): string {
  if (level === "team" ? !TEAM_KEY.test(id) : !slug(id)) {
    throw new Error(level === "team" ? `'${id}' isn't a team key: capital letters and digits, starting with a letter, e.g. WEB` : `'${id}' isn't a ${level} id: lowercase words joined by hyphens, e.g. finance`);
  }
  if (!input.name?.trim()) throw new Error(`A ${level} needs a name (--name)`);
  const taken = takenProblem(repo, id);
  if (taken) throw new Error(taken);
  const people = { ...(input.owner ? { owner: input.owner } : {}), ...(input.members?.length ? { members: input.members } : {}) };
  let data: Record<string, unknown>;
  if (level === "group") {
    if (input.department) {
      const dept = findArea(repo, input.department);
      if (dept.level !== "department") throw new Error(`${input.department} is ${dept.rel}, not a department`);
    }
    data = { name: input.name.trim(), ...(input.department ? { department: input.department } : {}), ...people };
  } else if (level === "team") {
    if (!input.home) throw new Error("A team reports to a department or group: --home <id>");
    const home = findArea(repo, input.home);
    if (home.level !== "department" && home.level !== "group") throw new Error(`A team's home is a department or group, and ${input.home} is ${home.rel}`);
    data = { name: input.name.trim(), home: home.id, ...people };
  } else data = { name: input.name.trim(), ...people };
  const path = join(repo, "planning", FOLDER[level], id, level === "team" ? "team.yaml" : "plan.yaml");
  store().write(path, yaml(data), { create: true });
  return path;
}

/** The rules of a planning repo that no single area can check alone. */
export function repoIssues(repo: string): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  const areas = listAreas(repo);
  const year = companyYear(repo);
  const rel = (a: Area, file: string) => `planning/${a.rel}/${file}`;
  for (const area of areas) {
    const own = area.level === "team" ? "team.yaml" : "plan.yaml";
    const data = areaFile(area);
    if (data === undefined) {
      issues.push({ file: rel(area, own), message: store().exists(join(area.dir, own)) ? "doesn't read as YAML" : `is missing: every ${area.level} has one` });
      continue;
    }
    const check = area.level === "team" ? checkTeam : checkArea;
    if (!check(data)) for (const m of describeErrors(check.errors)) issues.push({ file: rel(area, own), message: m });
    if (area.level === "team" && store().exists(join(area.dir, "plan.yaml"))) issues.push({ file: rel(area, "plan.yaml"), message: "A team has no plan.yaml: its name, home and members are in team.yaml" });
    if (area.level === "team" && !TEAM_KEY.test(area.id)) issues.push({ file: `planning/${area.rel}`, message: `'${area.id}' isn't a team key: capital letters and digits, e.g. WEB` });
    if (area.level !== "team" && area.level !== "company" && !slug(area.id)) issues.push({ file: `planning/${area.rel}`, message: `'${area.id}' isn't an id: lowercase words joined by hyphens` });
    if (area.level === "company" && !YEAR.test(String(data.period ?? ""))) issues.push({ file: rel(area, own), message: `The company plans by year: period is a year, such as ${new Date().getUTCFullYear() + 1}` });
    if (area.level !== "company" && data.period !== undefined) issues.push({ file: rel(area, own), message: `Only the company has a period. Departments plan by quarter on their key results (period: ${year ?? "2027"}-Q1), and ${area.level === "department" ? "a department" : `a ${area.level}`}'s bets have review dates` });
    if (area.level !== "company" && data.pillars !== undefined) issues.push({ file: rel(area, own), message: "Only the company sets pillars" });
    if ((area.level === "group" || area.level === "team") && data.objectives?.length) issues.push({ file: rel(area, own), message: `Objectives stop at department level, so a ${area.level} has none` });
    if (area.level === "group" && data.department) {
      const dept = byId(repo, String(data.department));
      if (dept?.level !== "department") issues.push({ file: rel(area, own), message: `department: there's no department called '${data.department}'` });
    }
    if (area.level === "team" && data.home) {
      const home = byId(repo, String(data.home));
      if (!home || (home.level !== "department" && home.level !== "group")) issues.push({ file: rel(area, own), message: `home: there's no department or group called '${data.home}'` });
    }
    for (const id of krIds(area.dir)) {
      const file = rel(area, `krs/${id}.yaml`);
      if (krAreaProblem(area)) {
        issues.push({ file, message: krAreaProblem(area)! });
        continue;
      }
      let kr: any;
      try {
        kr = parse(store().read(join(area.dir, "krs", `${id}.yaml`)));
      } catch {
        continue; // reported with the area's own files
      }
      const period = kr?.period === undefined ? undefined : String(kr.period);
      const problem = periodProblem(area, period);
      if (problem) issues.push({ file, message: problem });
    }
  }
  // Ids are unique within the company: areas, key results and bets alike.
  const seen = new Map<string, Entry>();
  for (const e of companyIds(repo)) {
    const key = e.id.toLowerCase();
    const first = seen.get(key);
    const where = (x: Entry) => (x.kind === "key result" || x.kind === "bet" ? `a ${x.kind} in ${x.area.rel}` : x.area.rel);
    if (first) issues.push({ file: `planning/${e.area.rel}`, message: `'${e.id}' is used twice: ${where(first)}, and ${where(e)}. Ids are unique within the company.` });
    else seen.set(key, e);
  }
  return issues;
}
