// `nikos start`: the first run. --plan makes the company's planning repo; --map (or --name/--key) sets a
// code repo up with a story map: maps/<key>/ (name and key from the folder), a Cucumber runner for its
// stack, and CI for its host, each only when it's missing. With no flags, in a terminal, it asks Plan or Spec.
import { basename, join, relative, resolve } from "node:path";
import { store } from "../lib/store.js";
import { detectStack } from "../verify/detect.js";
import { detectHost, setupCi } from "./ci.js";
import { init } from "./init.js";
import { suggest, type Suggestion } from "./suggest.js";
import { setupVerify } from "./verify.js";
import { createInterface } from "node:readline/promises";
import { askOnboarding, Cancelled, setUp } from "./onboard.js";
import { cliCommand } from "../lib/cli-version.js";
import { REPO_PATH } from "../lib/bets.js";
import { initPlanRepo, oldLayoutProblem } from "../plan/repo.js";
import { describeRepoJoin, joinPlanRepo } from "./join.js";
import { isPlanRepo } from "../planning/model.js";

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
  if (store().isDir(join(root, "intent"))) throw new Error("This repo keeps its story map in intent/. Move intent/ to maps/<key>/ by hand, as the release notes describe, then start.");
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
      try {
        console.log(describeRepoJoin(joinPlanRepo(dir, { plan: joinTo, host: flag("host") })));
      } catch (err) {
        throw new Error(`${(err as Error).message} The story map is set up.`);
      }
    }
    console.log(`\n${r.next.summary}\n${r.next.options.map((o, n) => `  ${n + 1}. ${o.label}`).join("\n")}`);
    console.log(`\nSee it in your browser: ${cliCommand()} serve`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
