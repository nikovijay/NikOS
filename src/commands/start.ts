// `nikos start`: the first run. --plan makes the company's planning repo; --map (or --name/--key) sets a
// code repo up with a story map: maps/<key>/ (name and key from the folder), a Cucumber runner for its
// stack, and CI for its host, each only when it's missing. With no flags, in a terminal, it asks Plan or Spec.
// `company init` and `group init` are the old plan commands, kept until they're removed.
import { existsSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { stringify } from "yaml";
import { store } from "../lib/store.js";
import { detectStack } from "../verify/detect.js";
import { detectHost, setupCi } from "./ci.js";
import { init, keyFor } from "./init.js";
import { suggest, type Suggestion } from "./suggest.js";
import { setupVerify } from "./verify.js";
import { createInterface } from "node:readline/promises";
import { askOnboarding, Cancelled, setUp } from "./onboard.js";
import { cliCommand } from "../lib/cli-version.js";
import { KEY } from "../lib/keys.js";
import { BELOW, planYaml, type PlanLevel } from "../lib/group-plan.js";
import { ownRepo } from "../lib/git.js";
import { REPO_PATH } from "../lib/bets.js";
import { initPlanRepo, oldLayoutProblem } from "../plan/repo.js";
import { describeRepoJoin, joinPlanRepo } from "./join.js";
import { isPlanRepo } from "../planning/model.js";

export type { PlanLevel };

export interface StartResult {
  /** One line per thing start did, or found already done. */
  done: string[];
  /** Things it couldn't do on its own, for the agent to ask about. */
  ask: string[];
  next: Suggestion;
}

export function start(root: string, opts: { name?: string; key?: string } = {}): StartResult {
  if (isPlanRepo(root)) throw new Error("This is the company's planning repo. Story maps live in code repos: run nikos start in one of those.");
  const old = oldLayoutProblem(root);
  if (old) throw new Error(old);
  if (store().isDir(join(root, "intent"))) throw new Error("This repo keeps its story map in intent/. Move it with nikos migrate maps first, then start.");
  if (store().isDir(join(root, "maps"))) throw new Error("This repo has maps/ (story maps). Add another story map with nikos map new, not start.");
  const done: string[] = [];
  const ask: string[] = [];
  const r = init(root, opts);
  done.push(`Created maps/${basename(r.mapDir)}/ for ${opts.name ?? basename(resolve(root))} (${r.validation.stories} starter story)`);
  const stack = detectStack(root);
  if (!stack) ask.push("Which language is this project in? There's no package.json, pyproject.toml or requirements.txt yet, so there's no scenario runner.");
  else {
    const v = setupVerify(root);
    done.push(v.created.length ? `Set up a Cucumber runner for ${stack} (${v.created.join(", ")}). Install it with: ${v.install}` : `The ${stack} scenario runner is already set up`);
    if (v.node) ask.push(v.node);
  }
  const host = detectHost(root);
  if (!host) ask.push("Is this repo on GitHub or GitLab? There's no origin remote yet, so CI isn't set up.");
  else if (stack) {
    const c = setupCi(root, { host });
    done.push(c.created.length ? `Added CI for ${host} (${c.created.join(", ")})${c.todo ? `. ${c.todo.split("\n")[0]}` : ""}` : `CI for ${host} is already set up`);
  }
  return { done, ask, next: suggest(root) };
}

export interface CompanyResult {
  created: string[];
  skipped: string[];
  /** A group's key. */
  key?: string;
  /** The line each department or group runs (or asks their agent to) to join. Undefined until the repo's path is known. */
  join?: string;
}

/** A group's key: the GROUP in its story ids. */
const GROUP_KEY = KEY;

/**
 * Write a plan repo for a company, a department or a group: plan.yaml, settings every level
 * below inherits, the plans below it, and a README on joining. Company and department plans set
 * objectives and key results; a group plan only makes bets, aimed at the department's key
 * results, since OKRs stop at department level. None of them has a story map of its own.
 */
export function companyInit(dir: string, opts: { name: string; key?: string; period?: string; departments?: string[]; repo?: string; host?: string; level?: PlanLevel; groupsDirect?: boolean }): CompanyResult {
  const level: PlanLevel = opts.level ?? "company";
  const name = opts.name?.trim();
  if (!name) throw new Error(`Give the ${level}'s name`);
  // A group's key is the GROUP in every story id, e.g. PAY in PAY-CHK-12.
  const key = level === "group" ? (opts.key ?? keyFor(name)).toUpperCase() : undefined;
  if (key !== undefined && !GROUP_KEY.test(key)) throw new Error(`'${key}' isn't a valid group key (letters and digits, starting with a letter, up to 10)`);
  const root = resolve(dir);
  // The repo's path, from --repo or its origin remote. With neither, the join line waits until it's known.
  const repo = opts.repo ?? ownRepo(root);
  const join_ = repo ? `npx -y nikos@latest join ${repo}${opts.host && opts.host !== "github.com" ? ` --host ${opts.host}` : ""}` : undefined;
  // A company with no departments between it and its groups: they plan against it directly.
  const below = opts.groupsDirect && level === "company" ? "Groups" : BELOW[level];
  const holds = level === "group" ? "bets, aimed at the department's key results" : "objectives, key results and bets";
  const files: Record<string, string> = {
    "planning/plan.yaml": planYaml({ name, key, period: opts.period, level, below }),
    "nikos.settings.yaml": `# Settings every level that joins this plan inherits.
# Lock a key so the levels below can't change it. To hold every level to the approval policy,
# lock its routes with it: locked: [approval.policy, approval.routes]
format_version: 1
approval:
  policy: optional          # off | optional | required-for-release
tracker:
  system: none              # jira | linear | github | gitlab | …: connect it with the tracker playbook
`,
    "planning/downstream.yaml": `# The ${below.toLowerCase()} that plan against this one: name, and their repo once they have one.\n${stringify((opts.departments ?? []).map((d) => ({ name: d.trim() })).filter((d) => d.name)) || "[]\n"}`,
    "README.md": `# ${name} plan

The ${level}'s ${holds}, planned with [nikOS](https://nikos.tools).
${below} plan against it from their own repos, and inherit the settings in
\`nikos.settings.yaml\`.

## Join this plan

From the repo below it, ask your agent to "join our ${level} plan", or run:

\`\`\`
${join_ ?? "npx -y nikos@latest join"}
\`\`\`
${join_ ? "" : "\nfollowed by this repo's path as it shows on GitHub or GitLab (owner/name).\n"}
It links your repo, fetches a read-only copy of this plan, and shows the settings you inherit.
Nothing in your repo moves.
`,
  };
  const created: string[] = [];
  const skipped: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    if (store().exists(path)) skipped.push(rel);
    else {
      store().write(path, text, { create: true });
      created.push(rel);
    }
  }
  for (const sub of level === "group" ? ["bets"] : ["krs", "bets"]) {
    const keep = join(root, "planning", sub, ".gitkeep");
    if (!store().exists(join(root, "planning", sub))) store().write(keep, "");
  }
  return { created, skipped, key, join: join_ };
}

/** A person at a terminal, not an agent, a pipe or CI: the only time start asks questions. */
export const interactive = () => !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI;

const START_USAGE = `Usage: nikos start --plan --name "<company>" --year <year> [--pillars "<a>, <b>"] [--owner <who>] [--dir <path>]
       nikos start --map [--name "<product>"] [--key <KEY>] [--join <planning repo>] [--host gitlab.com] [--dir <path>]
Run it in a terminal, with no flags, to answer a few questions instead.`;

/** The comma-separated list a flag takes, or none. */
const listFlag = (a: string | undefined) => a?.split(",").map((x) => x.trim()).filter(Boolean);

export async function runStart(args: string[]): Promise<number> {
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (n: string) => args.includes(`--${n}`);
  const dir = flag("dir") ?? process.cwd();
  if (has("plan") && has("map")) {
    console.error(`✗ Pick one: --plan makes the company's planning repo, --map makes a story map for this code.\n\n${START_USAGE}`);
    return 1;
  }
  if (has("plan")) return startPlan(dir, flag, has);
  if (has("map") || has("name") || has("key")) return startMap(dir, flag, has);
  if (has("yes") || !interactive()) {
    console.error(`✗ nikos start needs to know what to set up: pass --plan or --map. Run it in a terminal to answer questions instead.\n\n${START_USAGE}`);
    return 1;
  }
  return startMenu(dir);
}

/** The Plan or Spec menu, in a terminal. */
async function startMenu(cwd: string): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answers = await askOnboarding(cwd, (q, s) => rl.question(`${q}${s ? ` [${s}]` : ""}${/[?)]$/.test(q) && !s ? " " : ": "}`));
    rl.close();
    console.log("");
    for (const line of setUp(answers, cwd)) console.log(line);
    return 0;
  } catch (err) {
    rl.close();
    if (err instanceof Cancelled) {
      console.log(err.message);
      return 0;
    }
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

/** --plan: the company's planning repo, with no story map. */
function startPlan(dir: string, flag: (n: string) => string | undefined, has: (n: string) => boolean): number {
  try {
    if (has("join")) throw new Error("--join links a code repo to a plan. Leave it out with --plan, and add departments with nikos plan add department <id>.");
    const problem = oldLayoutProblem(dir);
    if (problem) throw new Error(problem);
    const name = flag("name");
    if (!name) throw new Error('--plan needs the company\'s name, with --name, for example: nikos start --plan --name "Acme" --year 2027');
    const files = initPlanRepo(dir, { name, year: flag("year") ?? "", pillars: listFlag(flag("pillars")), owner: flag("owner") });
    const cli = cliCommand();
    console.log(`Made the company's planning repo:\n${files.map((f) => `  + ${relative(dir, f)}`).join("\n")}`);
    console.log(`\nNext steps:\n  1. Add a department: ${cli} plan add department <id> --name "<name>"\n  2. See the plan: ${cli} plan status\n  3. Open it in your browser: ${cli} plan serve`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

/** --map, or --name or --key: a story map for this code, and --join to link it to a planning repo. */
function startMap(dir: string, flag: (n: string) => string | undefined, has: (n: string) => boolean): number {
  try {
    const joinTo = flag("join");
    if (has("join") && (!joinTo || !REPO_PATH.test(joinTo))) throw new Error("--join needs the planning repo's path, for example: --join acme/company-plan");
    const r = start(dir, { name: flag("name"), key: flag("key") });
    for (const d of r.done) console.log(`✓ ${d}`);
    for (const a of r.ask) console.log(`? ${a}`);
    if (joinTo) {
      const listed = joinPlanRepo(dir, { plan: joinTo, host: flag("host") });
      if (!listed) throw new Error(`Couldn't read ${joinTo} as a planning repo (planning/company/), so nothing was joined. The story map is set up.`);
      console.log(describeRepoJoin(listed));
    }
    console.log(`\n${r.next.summary}\n${r.next.options.map((o, n) => `  ${n + 1}. ${o.label}`).join("\n")}`);
    console.log(`\nSee it in your browser: ${cliCommand()} serve`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

// Shown when a required option is missing. The examples run as they are.
const USAGE: Record<PlanLevel, string> = {
  company: 'Usage: nikos company init --name "<company>" [--level department] [--period "Q1 2027"] [--departments "Payments, Growth"] [--repo owner/company-plan] [--host gitlab.com] [--dir <path>]',
  department: 'Usage: nikos company init --level department --name "<department>" [--period "Q1 2027"] [--departments "<groups>"] [--repo owner/payments-plan] [--host gitlab.com] [--dir <path>]',
  group: 'Usage: nikos group init --name "<group>" [--key <KEY>] [--period "Q1 2027"] [--repo owner/checkout-group] [--host gitlab.com] [--dir <path>]',
};

/** `nikos company init` (a company, or a department with --level department) and `nikos group init`. */
function runPlanInit(args: string[], fixed?: PlanLevel): number {
  const [sub, ...rest] = args;
  const flag = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const asked = flag("level");
  if (!fixed && asked && asked !== "company" && asked !== "department") {
    console.error(asked === "group" ? "✗ A group plan has its own command: nikos group init" : `✗ --level can be company or department, not '${asked}'`);
    return 1;
  }
  const level: PlanLevel = fixed ?? (asked as PlanLevel | undefined) ?? "company";
  if (flag("key") !== undefined && level !== "group") {
    console.error("✗ Only a group plan has a key. Leave out --key, or use nikos group init");
    return 1;
  }
  if (sub !== "init" || !flag("name")) {
    const example = { company: 'nikos company init --name "Acme" --period "Q1 2027"', department: 'nikos company init --level department --name "Payments"', group: 'nikos group init --name "Checkout" --key CHK' }[level];
    console.error(`${sub === "init" ? `✗ It needs the ${level}'s name, with --name. For example:\n  ${example}\n\n` : ""}${USAGE[level]}`);
    return 1;
  }
  try {
    const dir = flag("dir") ?? process.cwd();
    const r = companyInit(dir, { name: flag("name")!, key: flag("key"), period: flag("period"), departments: flag("departments")?.split(","), repo: flag("repo"), host: flag("host"), level });
    const cli = cliCommand();
    if (r.key && flag("key") === undefined) console.log(`Group key ${r.key} (from the name; set another with --key)`);
    if (r.created.length) console.log(`Made the ${level} plan in ${resolve(dir)}:\n${r.created.map((f) => `  + ${f}`).join("\n")}`);
    if (r.skipped.length) console.log(`Left alone, because they were already there:\n${r.skipped.map((f) => `  = ${f}`).join("\n")}`);
    const next: string[] = [];
    if (!existsSync(join(dir, ".git"))) next.push(`Make it a git repo and put it on GitHub or GitLab, so others can reach it: git init, then push it.`);
    next.push(r.join ? `${BELOW[level]} join it with: ${r.join}` : `${BELOW[level]} join it with ${cli} join and this repo's path, once it's on GitHub or GitLab. Or run this command again with --repo and that path, to print the exact line.`);
    if (level !== "company") {
      const above = level === "group" ? "department" : "company";
      next.push(`Link it to the ${above} plan: ${cli} join and that plan's repo path, like ${cli} join acme/${above === "company" ? "company-plan" : "payments-plan"}`);
    }
    next.push(`See it in your browser: ${cli} serve`);
    console.log(`\nNext steps:\n${next.map((l, n) => `  ${n + 1}. ${l}`).join("\n")}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

export const runCompany = (args: string[]) => runPlanInit(args);
export const runGroup = (args: string[]) => runPlanInit(args, "group");
