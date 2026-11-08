// `nikos planning …`: the command line for the nikos-planning pack.
import { betIds, findRoot, krIds, loadBet, loadKr } from "./model.js";
import { planningIssues } from "./levels.js";
import { DECISIONS, newBet, reviewBet, type Decision } from "./bets.js";
import { checkIn, isStale, latest, newKr, reviseTarget } from "./krs.js";
import { delivery, describeDelivery } from "./delivery.js";
import { crossRefs, runSync } from "./upstream.js";
import { runServe } from "./server.js";
import { addDownstream, formatRollout, rollout } from "./rollout.js";

const help = `nikos planning — bets, key results and the planning dashboard

Usage: nikos planning <command> [options] [--dir <repo>]

Commands:
  bet new <id>       Write planning/bets/<id>.md
                     (--owner, --hypothesis, --review YYYY-MM-DD, --kr <primary>, --also <ref>,
                      --aligns-to <repo path>#<bet> (repeat for several: bets in the plan directly above),
                      --team, --starts, --deadline, --confidence low|medium|high, --dependency, --evidence)
  bet review <id> <continue|change|stop|complete>  Add a dated review decision (--why, --outcome won|lost)
  kr new <id>        Write planning/krs/<id>.yaml: company and department plans only
                     (--title, --owner, --baseline, --target, --by YYYY-MM-DD, --unit, --objective,
                      --aligns-to <repo path>#<kr> (repeat for several), --stale-after <days>)
  kr target <id> <n> Revise a key result's target; the original is kept
  checkin <kr> <value>  Add a dated check-in (--note, --evidence, --date)
  status             Every bet's delivery and outcome, every key result's latest value
  validate           Check planning/ against its schemas and the rules for its level
  sync [--check]     Fetch the plans in planning/upstream.yaml read-only into .nikos/upstream/
  downstream add <name>  List a department or team below this plan (--repo <path>, --host gitlab.com,
                     --url <git url> for any other host, an SSH url or a local repo; --home <repo>
                     when it is homed in another plan this one doesn't own)
  rollout            How the plans below this one are doing: joined, last synced, delivery, and
                     the key results and bets that point here (--json, --offline, --as <repo path>)
  serve              Open the local dashboard (--port). --export <file> writes it as one offline page;
                     add --editable to queue changes in that page and download them as a change
                     file for nikos apply (--with-linked embeds the plans above and below, read-only)`;

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
    out.push(`  ${id} — delivery: ${describeDelivery(delivery(root, id))} · outcome: ${b.outcome} · review on ${b.review_on}`);
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
        if (has("export") && opt("export") === "true") throw new Error("--export needs a file: --export <file>");
        return await runServe(root, {
          port: opt("port") ? Number(opt("port")) : undefined,
          exportTo: opt("export"),
          map: opt("map"),
          editable: has("editable"),
          withLinked: has("with-linked"),
        });
    }
    console.error(`Unknown planning command.\n\n${help}`);
    return 1;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
