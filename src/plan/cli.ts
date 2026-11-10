// `nikos plan`: the company's planning repo. Every level is a folder (company, departments, groups,
// teams); a command works in the area named with --in, or the area folder you're in. Key results and
// bets are found by id anywhere in the company, since ids are unique within it.
import { relative } from "node:path";
import { closest } from "../lib/closest.js";
import { summaryAge } from "../lib/delivery-summary.js";
import { formatSettings, resolveSettingsDetailed, setSetting } from "../lib/settings.js";
import { DECISIONS, newBet, reviewBet, type Decision } from "../planning/bets.js";
import { parseArgs } from "../lib/args.js";
import { checkIn, directionOf, isStale, kindOf, latest, markStep, newKr, reviseTarget } from "../planning/krs.js";
import { alignsList, laddersOf, linkedOf, planningIssues } from "../planning/levels.js";
import { acceptLadder, clearLadder, findItem, ladderFor, unlinkedItems } from "../planning/ladder.js";
import { betIds, krIds, loadBet, loadKr, type Area, type PlanningIssue } from "../planning/model.js";
import { planDeliveries, type BetDelivery, type PlanDeliveries } from "./delivery.js";
import { addArea, areaFile, areaFor, areaHolding, companyYear, findPlanRepo, initPlanRepo, listAreas, oldLayoutProblem, parentOf, repoIssues } from "./repo.js";
import { loadRepos, reposIssues, type RepoEntry } from "./repos.js";
import { hostOfEntry, refreshDelivery } from "./refresh.js";
import { exportPlanPage, runPlanServe } from "./serve.js";
import { figuresText, readsText, repoLabel } from "./words.js";

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
                       --period 2027-Q1 for a department, --by, --unit, --objective, --aligns-to,
                       --direction up|down for a figure that should go down, such as days to close)
                       A milestone has steps instead: --kind milestone --step "<name>" (repeat --step)
                       --ladders-up "<text>" says what it ladders up to until a link exists (not for a company key result)
  plan kr target <id> <value>   Move a key result's target. The original stays recorded
  plan kr step <id> "<name>"    Mark one step of a milestone done (--date, default today)
  plan checkin <kr-id> <value>  Record where a key result is now (--note, --evidence, --date). Not for a milestone: use plan kr step
  plan bet new <id>    Add a bet (--in <area>, --owner, --hypothesis, --review YYYY-MM-DD, --kr,
                       --also, --aligns-to, --starts, --deadline, --confidence, --evidence, --ladders-up)
  plan bet review <id> <continue|change|stop|complete>   Record a review (--why, --outcome)
  plan ladder          The items whose ladders_up text has no link yet (--json)
  plan ladder <id>     What an item could link to, ranked by the words it shares with its text (--json)
  plan ladder accept <id> <candidate>   Link it: the link is written, and the text goes
  plan ladder clear <id>                Clear the text, when no link is wanted

See and check it
  plan status      Every area's key results and bets, or one area's (--in <area>). Each bet's
                   delivery and how old its copy is. --json for a copy a script can read
  plan validate    Check the whole plan. A map that names an unknown bet, or a repo never read,
                   is a warning: validate still passes
  plan refresh     Read each code repo in planning/repos.yaml, read-only, and keep its delivery copy
  plan serve       Run the planning dashboard and print its link, to open in your browser. One area
                   at a time (--in <area> to start on one, --port, --offline to skip the refresh).
                   --export <file> writes one offline page: the --in area's, or every area's when
                   there is no --in
  plan settings [set <key> <value>]   The settings for an area, and where each comes from (--in)

--in takes company, departments/finance, groups/payments or teams/WEB, or just the id.
Without it, the area is the folder you're in.`;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? NaN : Number(s));

/** A milestone's steps in words: "1 of 3 steps done: Map steps on 2026-11-10. To do: Pilot, Roll out". */
function stepsText(k: any): string {
  const steps: { name: string; done?: string }[] = k.steps ?? [];
  const did = steps.filter((s) => s.done).map((s) => `${s.name} on ${s.done}`);
  const todo = steps.filter((s) => !s.done).map((s) => s.name);
  return `${steps.length - todo.length} of ${steps.length} steps done${did.length ? `: ${did.join(", ")}` : ""}${todo.length ? `. To do: ${todo.join(", ")}` : ""}`;
}

/** The words a person wrote, for an item no link backs yet: the status line says so. Nothing once linked. */
const notLinkedYet = (data: any, kind: "kr" | "bet"): string => {
  const text = laddersOf(data);
  return text && !linkedOf(kind, data) ? ` · not linked yet: "${text}"` : "";
};

/** The ladders_up fields for --json: the text, and whether a link backs it. Nothing when there's no text. */
const ladderJson = (data: any, kind: "kr" | "bet") => {
  const text = laddersOf(data);
  return text ? { laddersUp: text, linked: linkedOf(kind, data) } : {};
};

function krLine(area: Area, id: string): string {
  const k = loadKr(area.dir, id).data;
  const last = latest(k);
  const unit = k.unit ?? "";
  const u = unit === "" || unit === "%" || unit === "$" ? unit : ` ${unit}`;
  const aligns = alignsList(k.aligns_to);
  if (kindOf(k) === "milestone") {
    return `    ${id} — ${k.title}: ${stepsText(k)} (by ${k.by})${
      area.level === "department" && k.period ? ` · ${k.period}` : ""
    }${aligns.length ? ` · aligns to ${aligns.join(", ")}` : ""}${notLinkedYet(k, "kr")}${isStale(k) ? " · stale" : ""}`;
  }
  return `    ${id} — ${k.title}: ${last ? `${last.value}${u} on ${last.date}` : "no check-ins"} (baseline ${k.baseline}${u}, target ${k.target}${u} by ${k.by})${
    area.level === "department" && k.period ? ` · ${k.period}` : ""
  }${directionOf(k) === "down" ? " · should go down" : ""}${aligns.length ? ` · aligns to ${aligns.join(", ")}` : ""}${notLinkedYet(k, "kr")}${isStale(k) ? " · stale" : ""}`;
}

function betLine(area: Area, id: string): string {
  const b = loadBet(area.dir, id).meta;
  const krs = [b.krs?.primary, ...(b.krs?.also ?? [])].filter(Boolean);
  const aligns = alignsList(b.aligns_to);
  return `    ${id} — outcome: ${b.outcome} · review on ${b.review_on}${krs.length ? ` · aims at ${krs.join(", ")}` : ""}${aligns.length ? ` · aligns to ${aligns.join(", ")}` : ""}${notLinkedYet(b, "bet")}`;
}

/** The repos planning/repos.yaml lists. A file that doesn't load lists none here: plan validate reports it. */
function listedRepos(repo: string): RepoEntry[] {
  try {
    return loadRepos(repo).repos;
  } catch {
    return [];
  }
}

interface DeliveryCtx {
  deliveries: PlanDeliveries;
  /** Whether planning/repos.yaml lists any code repo. */
  listed: boolean;
}

/** A bet's delivery lines: its own figures, or each bet below it that has maps, on its own. Never added up. */
function deliveryLines(d: BetDelivery, ctx: DeliveryCtx): string[] {
  if (d.source === "own" && d.delivery) return [`    delivery: ${figuresText(d.delivery)}${readsText(d.reads)}`];
  if (d.source === "via") {
    return d.via.map((v) => {
      const reads = d.reads.filter((r) => v.delivery.maps.some((m) => m.host === r.host && m.repo === r.repo));
      return `    delivery via ${v.bet}: ${figuresText(v.delivery)}${readsText(reads)}`;
    });
  }
  if (!ctx.deliveries.cached) return [`    delivery: ${ctx.listed ? "no read yet: run nikos plan refresh" : "no code repos listed yet in planning/repos.yaml"}`];
  return ["    delivery: no story map names this bet yet"];
}

/** One area: its name and where it sits, then its key results and bets. */
function areaStatus(area: Area, ctx: DeliveryCtx): string {
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
  for (const id of bets) {
    out.push(betLine(area, id));
    const d = ctx.deliveries.bets.get(id);
    if (d) out.push(...deliveryLines(d, ctx));
  }
  return out.join("\n");
}

/** Delivery warnings for plan status and plan validate: bet links that name nothing here, and repos never read. */
export function deliveryIssues(repo: string, d: PlanDeliveries): PlanningIssue[] {
  const links: PlanningIssue[] = d.warnings.map((w) => ({ file: w.map ? `${w.repo} maps/${w.map}` : (w.repo ?? "planning"), message: w.message, warning: true }));
  const listed = listedRepos(repo);
  if (!listed.length) return links;
  if (!d.cached) return [...links, { file: "planning/repos.yaml", message: "no code repo has been read yet: run nikos plan refresh", warning: true }];
  const never = listed
    .filter((e) => !d.repos.some((r) => r.repo === e.repo && r.host === hostOfEntry(e)))
    .map((e) => ({ file: "planning/repos.yaml", message: `${e.repo} has never been read: run nikos plan refresh`, warning: true }));
  return [...links, ...never];
}

/** The plan's status as text: each code repo's copy, then each area, then any delivery warnings. */
export function planStatus(repo: string, area?: Area, deliveries: PlanDeliveries = planDeliveries(repo)): string {
  const ctx: DeliveryCtx = { deliveries, listed: listedRepos(repo).length > 0 };
  const head = deliveries.repos.map((r) => `Code repo ${repoLabel(r)}: ${r.age}`);
  const body = (area ? [area] : listAreas(repo)).map((a) => areaStatus(a, ctx));
  const warnings = deliveryIssues(repo, deliveries).map((i) => `! ${i.file}: ${i.message}`);
  return [...(head.length ? [head.join("\n")] : []), ...body, ...(warnings.length ? [warnings.join("\n")] : [])].join("\n\n");
}

function keyResultJson(area: Area, id: string) {
  const k = loadKr(area.dir, id).data;
  const last = latest(k);
  if (kindOf(k) === "milestone") {
    return {
      id,
      title: k.title,
      kind: "milestone",
      by: k.by,
      ...(k.period ? { period: k.period } : {}),
      steps: (k.steps ?? []).map((s: any) => ({ name: s.name, done: s.done ?? null })),
      stale: isStale(k),
      aligns_to: alignsList(k.aligns_to),
      ...ladderJson(k, "kr"),
    };
  }
  return {
    id,
    title: k.title,
    baseline: k.baseline,
    target: k.target,
    by: k.by,
    ...(k.unit ? { unit: k.unit } : {}),
    ...(k.period ? { period: k.period } : {}),
    ...(k.direction ? { direction: k.direction } : {}),
    latest: last ? { value: last.value, date: last.date } : null,
    stale: isStale(k),
    aligns_to: alignsList(k.aligns_to),
    ...ladderJson(k, "kr"),
  };
}

/** The plan's status as data, for --json: each repo's copy, each area with its bets' delivery, and the warnings. */
export function planStatusJson(repo: string, area?: Area, deliveries: PlanDeliveries = planDeliveries(repo)): string {
  const areas = (area ? [area] : listAreas(repo)).map((a) => {
    const file = areaFile(a) ?? {};
    const krs = a.level === "company" || a.level === "department" ? krIds(a.dir) : [];
    return {
      rel: a.rel,
      level: a.level,
      name: file.name ?? null,
      reportsTo: parentOf(a)?.rel ?? null,
      keyResults: krs.map((id) => keyResultJson(a, id)),
      bets: betIds(a.dir).map((id) => {
        const b = loadBet(a.dir, id).meta;
        return {
          id,
          outcome: b.outcome,
          reviewOn: b.review_on,
          aimsAt: [b.krs?.primary, ...(b.krs?.also ?? [])].filter(Boolean),
          alignsTo: alignsList(b.aligns_to),
          ...ladderJson(b, "bet"),
          delivery: deliveries.bets.get(id) ?? null,
        };
      }),
    };
  });
  const warnings = deliveryIssues(repo, deliveries).map(({ file, message }) => ({ file, message }));
  return JSON.stringify({ repos: deliveries.repos, areas, warnings }, null, 2);
}

/** Every problem in the plan: the repo's own rules, then each area's files and links. */
export function planIssues(repo: string): PlanningIssue[] {
  return [...repoIssues(repo), ...reposIssues(repo), ...listAreas(repo).flatMap((a) => planningIssues(a.dir)), ...deliveryIssues(repo, planDeliveries(repo))];
}

export async function runPlanRepo(args: string[]): Promise<number> {
  const { positional, all, opt, has } = parseArgs(args, ["json", "offline"]);
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
  // A repo with the old planning/plan.yaml is refused by every command but init, which says why too.
  const old = oldLayoutProblem(repoOrNone ?? cwd);
  if (old && cmd !== undefined && cmd !== "help" && cmd !== "init") {
    console.error(`✗ ${old}`);
    return 1;
  }
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
              direction: opt("direction") as "up" | "down" | undefined,
              kind: opt("kind") as "number" | "milestone" | undefined,
              steps: all("step"),
              alignsTo: all("aligns-to"),
              laddersUp: opt("ladders-up"),
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
        if (sub === "step" && id && extra !== undefined) {
          console.log(`Wrote ${markStep(areaHolding(need(), id, "key result").dir, id, extra, opt("date"))}`);
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
              laddersUp: opt("ladders-up"),
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
        const where = areaFor(repo, opt("in"), cwd);
        const deliveries = planDeliveries(repo);
        console.log(opt("json") !== undefined ? planStatusJson(repo, where, deliveries) : planStatus(repo, where, deliveries));
        return 0;
      }
      case "ladder": {
        const repo = need();
        // accept and clear take an item and, for accept, a candidate. Any other word is an item to show.
        if (sub === "accept" && id !== undefined && extra !== undefined) {
          const where = findItem(repo, id);
          console.log(`Linked ${id} to ${extra}: wrote ${acceptLadder(where.area.dir, where.kind, id, extra)}`);
          return 0;
        }
        if (sub === "clear" && id !== undefined) {
          const where = findItem(repo, id);
          console.log(`Wrote ${clearLadder(where.area.dir, where.kind, id)}`);
          return 0;
        }
        if (sub === "accept" || sub === "clear") throw new Error(sub === "accept" ? "Name the link: nikos plan ladder accept <id> <candidate>" : "Name the item: nikos plan ladder clear <id>");
        if (sub === undefined) {
          const items = unlinkedItems(repo);
          if (has("json")) console.log(JSON.stringify({ items }, null, 2));
          else if (!items.length) console.log("No key result or bet is waiting for a link: every ladders_up text has one, or none is written.");
          else console.log(`${items.map((i) => `${i.id} (${i.kind}, ${i.rel}): "${i.text}"`).join("\n")}\n\nSee what each could link to with: nikos plan ladder <id>`);
          return 0;
        }
        const r = ladderFor(repo, sub);
        if (has("json")) console.log(JSON.stringify(r, null, 2));
        else {
          const lines = [`${r.id} (${r.kind}, ${r.rel})${r.text ? ` ladders up to "${r.text}"` : ": no ladders_up text"}${r.linked ? " · already linked" : ""}`];
          if (!r.candidates.length) lines.push(`  Nothing above it shares words with its text. Link it by hand with --aligns-to${r.kind === "bet" ? " (a bet) or --kr (a key result)" : ""}.`);
          for (const c of r.candidates) lines.push(`  ${c.id} — ${c.kind} in ${c.rel}: ${c.title} (shares ${c.shared.join(", ")})`);
          if (r.candidates.length) lines.push(`\nLink one with: nikos plan ladder accept ${r.id} <candidate>`);
          console.log(lines.join("\n"));
        }
        return 0;
      }
      case "refresh": {
        const repo = need();
        for (const r of refreshDelivery(repo).repos) {
          if (r.state === "ok") console.log(`✓ ${r.repo}: ${summaryAge({ read_at: r.read_at! })} at ${r.commit!.slice(0, 7)}`);
          else if (r.kept) console.log(`! ${r.repo}: unreachable (${r.reason}); showing the copy ${summaryAge({ read_at: r.read_at! })}`);
          else console.log(`! ${r.repo}: unreachable (${r.reason}); no copy yet`);
        }
        return 0;
      }
      case "serve": {
        // Checked here: parseArgs ignores a flag it doesn't know, and a typo should not start a server.
        const flags = ["port", "offline", "export", "in", "at", "dir"];
        const unknown = args.filter((a) => a.startsWith("--")).map((a) => a.slice(2)).filter((n) => !flags.includes(n));
        if (unknown.length) throw new Error(`Unknown option --${unknown[0]} for plan serve. The options are ${flags.map((f) => `--${f}`).join(", ")}`);
        const portText = opt("port");
        const port = portText === undefined ? undefined : Number(portText);
        if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error("--port takes a port number, for example --port 4777");
        const repo = need();
        const at = opt("in") ?? opt("at");
        if (opt("export") !== undefined) {
          const { wrote, notices } = await exportPlanPage(repo, opt("export")!, { offline: has("offline"), at });
          for (const n of notices) console.log(`! ${n}`);
          console.log(`Saved the plan page: ${wrote}`);
          return 0;
        }
        return await runPlanServe(repo, { port, offline: has("offline"), at });
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
    const known = ["init", "add", "kr", "checkin", "bet", "ladder", "status", "validate", "refresh", "serve", "settings", "help"];
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
