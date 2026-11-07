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
import { init } from "./init.js";
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
  /** The line each department or team runs (or asks their agent to) to join. */
  join: string;
}

/** Write a company plan repo: plan.yaml, settings every level inherits, the departments, and a README on joining. */
export function companyInit(dir: string, opts: { name: string; period?: string; departments?: string[]; repo?: string; host?: string }): CompanyResult {
  const name = opts.name?.trim();
  if (!name) throw new Error("Give the company's name");
  const root = resolve(dir);
  const repo = opts.repo ?? `<owner>/${basename(root)}`;
  const join_ = `npx -y nikos@latest join ${repo}${opts.host && opts.host !== "github.com" ? ` --host ${opts.host}` : ""}`;
  const files: Record<string, string> = {
    "planning/plan.yaml": `# ${name}'s plan. Departments and teams align their key results and bets to it.\n${stringify({ name, period: opts.period ?? "Set the period, e.g. Q1 2027", level: "company", pillars: [] })}`,
    "nikos.settings.yaml": `# Settings every department, group and team that joins this plan inherits.
# Lock a key so the levels below can't change it. To hold every level to the approval policy,
# lock its routes with it: locked: [approval.policy, approval.routes]
format_version: 1
approval:
  policy: optional          # off | optional | required-for-release
tracker:
  system: none              # jira | linear | github | gitlab | …: connect it with the tracker playbook
`,
    "planning/downstream.yaml": `# The departments and teams that plan against this one: name, and their repo once they have one.\n${stringify((opts.departments ?? []).map((d) => ({ name: d.trim() })).filter((d) => d.name)) || "[]\n"}`,
    "README.md": `# ${name} plan

The company's objectives, key results and bets, planned with [nikOS](https://nikos.tools).
Departments and teams plan against it from their own repos, and inherit the settings in
\`nikos.settings.yaml\`.

## Join this plan

From a department's or team's repo, ask your agent to "join our company plan", or run:

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
  for (const sub of ["krs", "bets"]) {
    const keep = join(root, "planning", sub, ".gitkeep");
    if (!store().exists(join(root, "planning", sub))) store().write(keep, "");
  }
  return { created, skipped, join: join_ };
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

export function runCompany(args: string[]): number {
  const [sub, ...rest] = args;
  const flag = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (sub !== "init" || !flag("name")) {
    console.error('Usage: nikos company init --name "<company>" [--period "Q1 2027"] [--departments "Payments, Growth"] [--repo owner/company-plan] [--host gitlab.com] [--dir <path>]');
    return 1;
  }
  try {
    const dir = flag("dir") ?? process.cwd();
    const r = companyInit(dir, { name: flag("name")!, period: flag("period"), departments: flag("departments")?.split(","), repo: flag("repo"), host: flag("host") });
    if (r.created.length) console.log(`Created:\n${r.created.map((f) => `  + ${f}`).join("\n")}`);
    if (r.skipped.length) console.log(`Skipped (already there):\n${r.skipped.map((f) => `  = ${f}`).join("\n")}`);
    console.log(`\nEach department or team joins with:\n  ${r.join}${existsSync(join(dir, ".git")) ? "" : "\n\nThis folder isn't a git repo yet: create the repo on GitHub or GitLab and push it, so others can join."}`);
    console.log(`\nSee it: ${cliCommand()} serve`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
