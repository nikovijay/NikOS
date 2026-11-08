// `nikos start` and `nikos company init`: the first run, for a team and for a company.
// start sets a repo up with sensible defaults: intent/ (name and key from the folder), a
// Cucumber runner for its stack, and CI for its host, each only when it's missing.
// company init writes a company plan repo that departments and teams join.
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";
import { store } from "../lib/store.js";
import { detectStack } from "../verify/detect.js";
import { detectHost, setupCi } from "./ci.js";
import { init, keyFor } from "./init.js";
import { suggest, type Suggestion } from "./suggest.js";
import { setupVerify } from "./verify.js";
import { createInterface } from "node:readline/promises";
import { askOnboarding, setUp } from "./onboard.js";
import { cliCommand } from "../lib/cli-version.js";

export interface StartResult {
  /** One line per thing start did, or found already done. */
  done: string[];
  /** Things it couldn't do on its own, for the agent to ask about. */
  ask: string[];
  next: Suggestion;
}

export function start(root: string, opts: { name?: string; key?: string } = {}): StartResult {
  const done: string[] = [];
  const ask: string[] = [];
  if (store().exists(join(root, "intent", "storymap.yaml"))) done.push("intent/ is already set up");
  else {
    const r = init(root, opts);
    const map = r.validation;
    done.push(`Created intent/ for ${opts.name ?? basename(resolve(root))} (${map.stories} starter story)`);
  }
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
  /** The line each department or team runs (or asks their agent to) to join. */
  join: string;
}

export type PlanLevel = "company" | "department" | "group";

/** A group's key: the GROUP in its story ids. */
const GROUP_KEY = /^[A-Z][A-Z0-9]{0,9}$/;

/** Who plans against each level, for its README and join line. */
const BELOW: Record<PlanLevel, string> = { company: "Departments", department: "Groups", group: "Teams" };

/**
 * Write a plan repo for a company, a department or a group: plan.yaml, settings every level
 * below inherits, the plans below it, and a README on joining. Company and department plans set
 * objectives and key results; a group plan only makes bets, aimed at the department's key
 * results, since OKRs stop at department level. None of them has a story map of its own.
 */
export function companyInit(dir: string, opts: { name: string; key?: string; period?: string; departments?: string[]; repo?: string; host?: string; level?: PlanLevel }): CompanyResult {
  const level: PlanLevel = opts.level ?? "company";
  const name = opts.name?.trim();
  if (!name) throw new Error(`Give the ${level}'s name`);
  // A group's key is the GROUP in every story id, e.g. PAY in PAY-CHK-12.
  const key = level === "group" ? (opts.key ?? keyFor(name)).toUpperCase() : undefined;
  if (key !== undefined && !GROUP_KEY.test(key)) throw new Error(`'${key}' isn't a valid group key (letters and digits, starting with a letter, up to 10)`);
  const root = resolve(dir);
  const repo = opts.repo ?? `<owner>/${basename(root)}`;
  const join_ = `npx -y nikos@latest join ${repo}${opts.host && opts.host !== "github.com" ? ` --host ${opts.host}` : ""}`;
  const below = BELOW[level];
  const holds = level === "group" ? "bets, aimed at the department's key results" : "objectives, key results and bets";
  const files: Record<string, string> = {
    "planning/plan.yaml": `# ${name}'s plan: its ${holds}.${level === "group" ? " OKRs stop at department level, so it has no key results of its own." : ` ${below} align their ${level === "company" ? "key results and bets" : "bets"} to it.`}\n${stringify({ name, ...(key ? { key } : {}), period: opts.period ?? "Set the period, e.g. Q1 2027", level, pillars: [] })}`,
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
${join_}
\`\`\`

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
const interactive = () => !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI;

export async function runStart(args: string[]): Promise<number> {
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (!flag("name") && !flag("key") && !args.includes("--yes") && interactive()) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const cwd = flag("dir") ?? process.cwd();
      const answers = await askOnboarding(cwd, (q, s) => rl.question(`${q}${s ? ` [${s}]` : ""}: `));
      rl.close();
      console.log("");
      for (const line of setUp(answers, cwd)) console.log(line);
      return 0;
    } catch (err) {
      rl.close();
      console.error(`✗ ${(err as Error).message}`);
      return 1;
    }
  }
  try {
    const r = start(flag("dir") ?? process.cwd(), { name: flag("name"), key: flag("key") });
    for (const d of r.done) console.log(`✓ ${d}`);
    for (const a of r.ask) console.log(`? ${a}`);
    console.log(`\n${r.next.summary}\n${r.next.options.map((o, n) => `  ${n + 1}. ${o.label}`).join("\n")}`);
    console.log(`\nSee it: ${cliCommand()} serve`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

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
    console.error(asked === "group" ? "✗ A group plan is set up with nikos group init" : `✗ --level is company or department, not '${asked}'`);
    return 1;
  }
  const level: PlanLevel = fixed ?? (asked as PlanLevel | undefined) ?? "company";
  if (flag("key") !== undefined && level !== "group") {
    console.error("✗ --key is for group plans");
    return 1;
  }
  if (sub !== "init" || !flag("name")) {
    console.error(USAGE[level]);
    return 1;
  }
  try {
    const dir = flag("dir") ?? process.cwd();
    const r = companyInit(dir, { name: flag("name")!, key: flag("key"), period: flag("period"), departments: flag("departments")?.split(","), repo: flag("repo"), host: flag("host"), level });
    if (r.key && flag("key") === undefined) console.log(`Group key ${r.key} (from the name; set another with --key)`);
    if (r.created.length) console.log(`Created:\n${r.created.map((f) => `  + ${f}`).join("\n")}`);
    if (r.skipped.length) console.log(`Skipped (already there):\n${r.skipped.map((f) => `  = ${f}`).join("\n")}`);
    console.log(`\n${BELOW[level]} join it with:\n  ${r.join}${existsSync(join(dir, ".git")) ? "" : "\n\nThis folder isn't a git repo yet: create the repo on GitHub or GitLab and push it, so others can join."}`);
    if (level !== "company") console.log(`\nLink it to the plan above with: ${cliCommand()} join <repo path of the ${level === "group" ? "department" : "company"} plan>`);
    console.log(`\nSee it: ${cliCommand()} serve`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

export const runCompany = (args: string[]) => runPlanInit(args);
export const runGroup = (args: string[]) => runPlanInit(args, "group");
