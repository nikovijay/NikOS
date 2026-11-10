// `nikos plan`: the company's planning repo. Every level is a folder (company, departments, groups,
// teams); a command works in the area named with --in, or the area folder you're in. Key results and
// bets are found by id anywhere in the company, since ids are unique within it.
import { relative } from "node:path";
import { closest } from "../lib/closest.js";
import { formatSettings, resolveSettingsDetailed, setSetting } from "../lib/settings.js";
import { DECISIONS, newBet, reviewBet, type Decision } from "../planning/bets.js";
import { parseArgs } from "../planning/cli.js";
import { checkIn, isStale, latest, newKr, reviseTarget } from "../planning/krs.js";
import { alignsList, planningIssues } from "../planning/levels.js";
import { betIds, krIds, loadBet, loadKr, type Area, type PlanningIssue } from "../planning/model.js";
import { addArea, areaFile, areaFor, areaHolding, companyYear, findPlanRepo, initPlanRepo, listAreas, parentOf, repoIssues } from "./repo.js";
import { reposIssues } from "./repos.js";

export const help = `nikos plan: the company's plan, in one planning repo

Every level has a folder under planning/: company/, departments/<id>/, groups/<id>/ and
teams/<KEY>/. The company plans by year, and departments by quarter. Only the company and
departments have key results. Every level has bets.

Set it up
  plan init        Make this repo the company's planning repo (--name, --year, --pillars, --owner)
  plan add department <id>   Add a department (--name, --owner, --member)
  plan add group <id>        Add a group (--name, --department <id>, --owner, --member)
  plan add team <KEY>        Add a team. It reports to a department or group (--name, --home <id>)

Key results and bets
  plan kr new <id>     Add a key result (--in <area>, --title, --owner, --baseline, --target,
                       --period 2027-Q1 for a department, --by, --unit, --objective, --aligns-to)
  plan kr target <id> <value>   Move a key result's target. The original stays recorded
  plan checkin <kr-id> <value>  Record where a key result is now (--note, --evidence, --date)
  plan bet new <id>    Add a bet (--in <area>, --owner, --hypothesis, --review YYYY-MM-DD, --kr,
                       --also, --aligns-to, --starts, --deadline, --confidence, --evidence)
  plan bet review <id> <continue|change|stop|complete>   Record a review (--why, --outcome)

See and check it
  plan status      Every area's key results and bets, or one area's (--in <area>)
  plan validate    Check the whole plan
  plan settings [set <key> <value>]   The settings for an area, and where each comes from (--in)

--in takes company, departments/finance, groups/payments or teams/WEB, or just the id.
Without it, the area is the folder you're in.`;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? NaN : Number(s));

function krLine(area: Area, id: string): string {
  const k = loadKr(area.dir, id).data;
  const last = latest(k);
  const unit = k.unit ?? "";
  const u = unit === "" || unit === "%" || unit === "$" ? unit : ` ${unit}`;
  const aligns = alignsList(k.aligns_to);
  return `    ${id} — ${k.title}: ${last ? `${last.value}${u} on ${last.date}` : "no check-ins"} (baseline ${k.baseline}${u}, target ${k.target}${u} by ${k.by})${
    area.level === "department" && k.period ? ` · ${k.period}` : ""
  }${aligns.length ? ` · aligns to ${aligns.join(", ")}` : ""}${isStale(k) ? " · stale" : ""}`;
}

function betLine(area: Area, id: string): string {
  const b = loadBet(area.dir, id).meta;
  const krs = [b.krs?.primary, ...(b.krs?.also ?? [])].filter(Boolean);
  const aligns = alignsList(b.aligns_to);
  return `    ${id} — outcome: ${b.outcome} · review on ${b.review_on}${krs.length ? ` · aims at ${krs.join(", ")}` : ""}${aligns.length ? ` · aligns to ${aligns.join(", ")}` : ""}`;
}

/** One area: its name and where it sits, then its key results and bets. */
function areaStatus(area: Area): string {
  const file = areaFile(area) ?? {};
  const above = parentOf(area);
  const out = [`${area.rel}${file.name ? ` — ${file.name}` : ""}${area.level === "company" && file.period ? ` (${file.period})` : above && area.level !== "department" ? ` · reports to ${above.rel}` : ""}`];
  if (area.level === "company" || area.level === "department") {
    const krs = krIds(area.dir);
    out.push(krs.length ? "  Key results:" : "  Key results: none");
    for (const id of krs) out.push(krLine(area, id));
  }
  const bets = betIds(area.dir);
  out.push(bets.length ? "  Bets:" : "  Bets: none");
  for (const id of bets) out.push(betLine(area, id));
  return out.join("\n");
}

export function planStatus(repo: string, area?: Area): string {
  return (area ? [area] : listAreas(repo)).map(areaStatus).join("\n\n");
}

/** Every problem in the plan: the repo's own rules, then each area's files and links. */
export function planIssues(repo: string): PlanningIssue[] {
  return [...repoIssues(repo), ...reposIssues(repo), ...listAreas(repo).flatMap((a) => planningIssues(a.dir))];
}

export async function runPlanRepo(args: string[]): Promise<number> {
  const { positional, all, opt } = parseArgs(args);
  const cwd = opt("dir") ?? process.cwd();
  const [cmd, sub, id, extra] = positional;
  const repoOrNone = findPlanRepo(cwd);
  const need = (): string => {
    if (!repoOrNone) throw new Error("This isn't a planning repo. Make one with: nikos plan init --name \"<company>\" --year <year>");
    return repoOrNone;
  };
  // The area to write in: --in, or the folder you're in.
  const area = (what: string): Area => {
    const a = areaFor(need(), opt("in"), cwd);
    if (!a) throw new Error(`Say where the ${what} goes with --in, for example --in company or --in departments/finance`);
    return a;
  };
  const show = (path: string) => relative(repoOrNone ?? cwd, path);
  try {
    switch (cmd) {
      case undefined:
      case "help":
        console.log(help);
        return 0;
      case "init": {
        const files = initPlanRepo(cwd, { name: opt("name") ?? "", year: opt("year") ?? "", pillars: opt("pillars")?.split(",").map((p) => p.trim()).filter(Boolean), owner: opt("owner") });
        console.log(`Made the company's planning repo:\n${files.map((f) => `  ${relative(cwd, f)}`).join("\n")}\n\nNext: add a department with nikos plan add department <id> --name "<name>"`);
        return 0;
      }
      case "add":
        if ((sub === "department" || sub === "group" || sub === "team") && id) {
          const path = addArea(need(), sub, id, { name: opt("name") ?? "", owner: opt("owner"), members: all("member"), department: opt("department"), home: opt("home") });
          console.log(`Added ${show(path)}`);
          return 0;
        }
        break;
      case "kr":
        if (sub === "new" && id) {
          const where = area("key result");
          const path = newKr(
            {
              id,
              title: opt("title") ?? "",
              owner: opt("owner") ?? "",
              baseline: num(opt("baseline")),
              target: num(opt("target")),
              by: opt("by") ?? "",
              period: opt("period"),
              unit: opt("unit"),
              objective: opt("objective"),
              alignsTo: all("aligns-to"),
              staleAfterDays: opt("stale-after") ? Number(opt("stale-after")) : undefined,
            },
            where.dir,
          );
          console.log(`Wrote ${path}`);
          return 0;
        }
        if (sub === "target" && id && extra !== undefined) {
          console.log(`Wrote ${reviseTarget(areaHolding(need(), id, "key result").dir, id, num(extra))}`);
          return 0;
        }
        break;
      case "checkin":
        if (sub && id !== undefined) {
          const where = areaHolding(need(), sub, "key result");
          console.log(`Wrote ${checkIn(where.dir, sub, { value: num(id), note: opt("note"), evidence: opt("evidence"), date: opt("date") })}`);
          return 0;
        }
        break;
      case "bet":
        if (sub === "new" && id) {
          const where = area("bet");
          const path = newBet(
            {
              id,
              owner: opt("owner") ?? "",
              hypothesis: opt("hypothesis") ?? "",
              reviewOn: opt("review") ?? "",
              team: opt("team"),
              starts: opt("starts"),
              deadline: opt("deadline"),
              primary: opt("kr"),
              also: all("also"),
              alignsTo: all("aligns-to"),
              confidence: opt("confidence") as any,
              dependencies: all("dependency"),
              evidence: opt("evidence"),
            },
            where.dir,
          );
          console.log(`Wrote ${path}`);
          return 0;
        }
        if (sub === "review" && id && extra) {
          if (!DECISIONS.includes(extra as Decision)) throw new Error(`A review decision is one of ${DECISIONS.join(", ")}`);
          const where = areaHolding(need(), id, "bet");
          console.log(`Wrote ${reviewBet(where.dir, id, { decision: extra as Decision, reason: opt("why") ?? "", outcome: opt("outcome") as any })}`);
          return 0;
        }
        break;
      case "status": {
        const repo = need();
        console.log(planStatus(repo, areaFor(repo, opt("in"), cwd)));
        return 0;
      }
      case "validate": {
        const repo = need();
        const found = planIssues(repo);
        const issues = found.filter((i) => !i.warning);
        for (const i of issues) console.log(`✗ ${i.file}: ${i.message}`);
        for (const w of found.filter((i) => i.warning)) console.log(`! ${w.file}: ${w.message}`);
        const areas = listAreas(repo);
        const krs = areas.reduce((n, a) => n + krIds(a.dir).length, 0);
        const bets = areas.reduce((n, a) => n + betIds(a.dir).length, 0);
        console.log(
          issues.length
            ? `\n${count(issues.length, "problem")} found.`
            : `✓ The plan${companyYear(repo) ? ` for ${companyYear(repo)}` : ""} is valid — ${count(areas.length, "area")}, ${count(krs, "key result")}, ${count(bets, "bet")}`,
        );
        return issues.length ? 1 : 0;
      }
      case "settings": {
        const where = areaFor(need(), opt("in"), cwd) ?? areaFor(need(), "company", cwd)!;
        if (sub === "set" && id && extra !== undefined) {
          let value: unknown = extra;
          try {
            value = JSON.parse(extra);
          } catch {
            // a plain word stays a string
          }
          console.log(`Wrote ${show(setSetting(where.dir, id, value))}`);
          return 0;
        }
        const { resolved, problems } = resolveSettingsDetailed(where.dir);
        console.log(`Settings for ${where.rel}:\n${formatSettings(resolved)}`);
        for (const p of problems) console.log(`! ${p}`);
        return 0;
      }
    }
    const known = ["init", "add", "kr", "checkin", "bet", "status", "validate", "settings", "help"];
    if (!known.includes(cmd)) {
      const near = closest(cmd, [...known, "new"]);
      console.error(`Unknown plan command '${cmd}'.${near ? ` Did you mean: nikos plan ${near}?` : ""}\nSee every plan command: nikos plan help`);
      return 1;
    }
    const line = help.split("\n").filter((l) => l.trimStart().startsWith(`plan ${cmd}`));
    console.error(`✗ Something is missing. How to use it:\n\n${line.join("\n")}\n\nSee every plan command: nikos plan help`);
    return 1;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
