// `nikos planning …`: the command line for the nikos-planning pack.
import { betIds, findRoot, krIds, loadBet, loadKr } from "./model.js";
import { planningIssues } from "./levels.js";
import { DECISIONS, newBet, reviewBet, type Decision } from "./bets.js";
import { checkIn, isStale, latest, newKr, reviseTarget } from "./krs.js";
import { delivery } from "./delivery.js";
import { crossRefs, runSync } from "./upstream.js";
import { runServe } from "./server.js";
import { findPlanRepo } from "../plan/repo.js";
import { closest } from "../lib/closest.js";
import { addDownstream, betDeliveryText, formatRollout, rollout } from "./rollout.js";

export const help = `nikos planning: key results, bets and check-ins

A key result is a number you want to move by a date, from a baseline to a target.
A bet is what you believe will move it, and why. It has a review date, not a deadline.

Usage: nikos planning <command> [options] [--dir <repo>]

Commands:
  kr new <id>        Add a key result, in planning/krs/<id>.yaml. Company and department plans only
                     (--title, --owner, --baseline, --target, --by YYYY-MM-DD, --unit, --objective,
                     --aligns-to <repo path>#<kr> to link it to one above (repeat for several),
                     --stale-after <days> before it asks for a check-in)
  kr target <id> <n> Move a key result's target. The original target stays on record
  checkin <kr> <value>  Record the key result's value today (--note, --evidence, --date)
  bet new <id>       Add a bet, in planning/bets/<id>.md
                     (--owner, --hypothesis, --review YYYY-MM-DD, --kr <the key result it moves>,
                     --also <another key result>, --aligns-to <repo path>#<bet> for a bet in the plan
                     directly above (repeat for several), --team, --starts, --deadline,
                     --confidence low|medium|high, --dependency, --evidence)
  bet review <id> <continue|change|stop|complete>  Record a review: what you decided and why
                     (--why, --outcome won|lost when you complete it)
  status             Show every key result's latest value, and every bet's delivery and outcome
  validate           Check the planning/ folder is well formed for its level
  sync [--check]     Fetch a read-only copy of the plans listed in planning/upstream.yaml,
                     into .nikos/upstream/ (--check only says whether they're current)
  downstream add <name>  List a department or team that plans under this one
                     (--repo <path>, --host gitlab.com, --url <git url> for any other host, an SSH
                     url or a local repo; --home <repo> when its home is a plan this one doesn't own)
  rollout            See how the plans under this one are doing: who joined, when they last
                     synced, delivery, and what points here (--json, --offline, --as <repo path>)
  serve              Open the dashboard (--port). --export <file> saves it as one offline page;
                     add --editable so people can suggest changes in it and download them as a file
                     for nikos apply (--with-linked includes the plans above and below, read-only)`;

/** The help's lines for one command: its entries, and the lines that continue them. */
function entryOf(cmd: string): string {
  const out: string[] = [];
  let on = false;
  for (const line of help.split("\n")) {
    if (/^  \S/.test(line)) on = line.trim().split(/\s/)[0] === cmd;
    else if (!/^     /.test(line)) on = false;
    if (on) out.push(`nikos planning ${line.trim()}`.replace(/^nikos planning (\(|--)/, "    $1"));
  }
  return out.join("\n");
}

/** Flags and positional words. A flag takes the next word as its value, unless it's a flag in `bools`, which never takes one. */
export function parseArgs(args: string[], bools: string[] = []) {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = args[i + 1];
      const takes = next !== undefined && !next.startsWith("--") && !bools.includes(name);
      const value = takes ? (i++, next) : "true";
      flags.set(name, [...(flags.get(name) ?? []), value]);
    } else positional.push(a);
  }
  return { positional, all: (n: string) => flags.get(n) ?? [], opt: (n: string) => flags.get(n)?.[0], has: (n: string) => flags.has(n) };
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? NaN : Number(s));

export function status(root: string): string {
  const out: string[] = [];
  const bets = betIds(root);
  out.push(bets.length ? "Bets:" : "Bets: none");
  for (const id of bets) {
    const b = loadBet(root, id).meta;
    // A bet with no stories here can still be delivered by a map below, such as a team's map for this company's bet.
    out.push(`  ${id} — delivery: ${betDeliveryText(root, id, delivery(root, id))} · outcome: ${b.outcome} · review on ${b.review_on}`);
  }
  const krs = krIds(root);
  out.push(krs.length ? "Key results:" : "Key results: none");
  for (const id of krs) {
    const k = loadKr(root, id).data;
    const last = latest(k);
    // A word unit (days) gets a space, as in the dashboard; % and $ stay tight to the number.
    const unit = k.unit ?? "";
    const u = unit === "" || unit === "%" || unit === "$" ? unit : ` ${unit}`;
    out.push(
      `  ${id} — ${k.title}: ${last ? `${last.value}${u} on ${last.date}` : "no check-ins"} (baseline ${k.baseline}${u}, target ${k.target}${u} by ${k.by})${isStale(k) ? " · stale" : ""}`,
    );
  }
  return out.join("\n");
}

export async function runPlanning(args: string[]): Promise<number> {
  const { positional, all, opt, has } = parseArgs(args, ["editable", "with-linked"]);
  const root = findRoot(opt("dir") ?? process.cwd());
  const [cmd, sub, id, extra] = positional;
  if (cmd && cmd !== "help" && findPlanRepo(root)) {
    console.error(`✗ This is a planning repo, where every level has a folder. Use nikos plan ${cmd} instead.\nSee every plan command: nikos plan help`);
    return 1;
  }
  try {
    switch (cmd) {
      case undefined:
      case "help":
        console.log(help);
        return 0;
      case "bet":
        if (sub === "new" && id) {
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
            root,
          );
          console.log(`Wrote ${path}`);
          return 0;
        }
        if (sub === "review" && id && extra) {
          if (!DECISIONS.includes(extra as Decision)) throw new Error(`A review decision is one of ${DECISIONS.join(", ")}`);
          const path = reviewBet(root, id, { decision: extra as Decision, reason: opt("why") ?? "", outcome: opt("outcome") as any });
          console.log(`Wrote ${path}`);
          return 0;
        }
        break;
      case "kr":
        if (sub === "new" && id) {
          const path = newKr(
            {
              id,
              title: opt("title") ?? "",
              owner: opt("owner") ?? "",
              baseline: num(opt("baseline")),
              target: num(opt("target")),
              by: opt("by") ?? "",
              unit: opt("unit"),
              objective: opt("objective"),
              alignsTo: all("aligns-to"),
              staleAfterDays: opt("stale-after") ? Number(opt("stale-after")) : undefined,
            },
            root,
          );
          console.log(`Wrote ${path}`);
          return 0;
        }
        if (sub === "target" && id && extra !== undefined) {
          console.log(`Wrote ${reviseTarget(root, id, num(extra))}`);
          return 0;
        }
        break;
      case "checkin":
        if (sub && id !== undefined) {
          console.log(`Wrote ${checkIn(root, sub, { value: num(id), note: opt("note"), evidence: opt("evidence"), date: opt("date") })}`);
          return 0;
        }
        break;
      case "status":
        console.log(status(root));
        return 0;
      case "validate": {
        const found = planningIssues(root);
        const issues = found.filter((i) => !i.warning);
        for (const i of issues) console.log(`✗ ${i.file}: ${i.message}`);
        for (const w of found.filter((i) => i.warning)) console.log(`! ${w.file}: ${w.message}`);
        // Unresolved upstream references are reported, never fatal: planning carries on without them.
        for (const r of crossRefs(root).filter((r) => !r.resolved)) console.log(`? ${r.file}: ${r.ref} is unresolved (not synced or not accessible)`);
        console.log(issues.length ? `\n${issues.length} ${issues.length === 1 ? "problem" : "problems"} found.` : `✓ planning/ is valid — ${count(betIds(root).length, "bet")}, ${count(krIds(root).length, "key result")}`);
        return issues.length ? 1 : 0;
      }
      case "sync":
        return await runSync(root, { check: has("check") });
      case "downstream":
        if (sub === "add" && id) {
          const r = addDownstream(root, { name: id, repo: opt("repo"), host: opt("host"), url: opt("url"), home: opt("home") });
          console.log(`${r.added ? "Added" : "Updated"} ${r.name}${r.repo ? ` (${r.repo})` : ""} in planning/downstream.yaml`);
          return 0;
        }
        break;
      case "rollout": {
        const r = rollout(root, { offline: has("offline"), as: opt("as") });
        console.log(has("json") ? JSON.stringify(r, null, 2) : formatRollout(r));
        return 0;
      }
      case "serve":
        if (has("export") && opt("export") === "true") throw new Error("--export needs a file name. For example: nikos planning serve --export plan.html");
        return await runServe(root, {
          port: opt("port") ? Number(opt("port")) : undefined,
          exportTo: opt("export"),
          map: opt("map"),
          editable: has("editable"),
          withLinked: has("with-linked"),
        });
    }
    // A typo gets the nearest command; a known command with something missing gets its own lines of the help.
    const known = ["bet", "kr", "checkin", "status", "validate", "sync", "downstream", "rollout", "serve", "help"];
    if (!known.includes(cmd)) {
      const near = closest(cmd, known);
      console.error(`Unknown planning command '${cmd}'.${near ? ` Did you mean: nikos planning ${near}?` : ""}\nSee every planning command: nikos planning help`);
      return 1;
    }
    console.error(`✗ Something is missing. How to use it:\n\n${entryOf(cmd)}\n\nSee every planning command: nikos planning help`);
    return 1;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
