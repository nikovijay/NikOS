// The first-run wizard: `nikos start` in a terminal, with no flags. It asks what's being set up, a
// plan for the company (Plan) or a story map for this code (Spec), where, and what to call it, one
// question at a time with a suggested answer, then runs the matching setup. Agents never see it: they
// pass flags (--plan or --map), and the onboard playbook asks the same questions in chat.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { keyFor, slugify } from "./init.js";
import { start } from "./start.js";
import { cliCommand, staleCliWarning } from "../lib/cli-version.js";
import { REPO_PATH } from "../lib/bets.js";
import { ownRepo } from "../lib/git.js";
import { KEY } from "../lib/keys.js";
import { initPlanRepo } from "../plan/repo.js";
import { describeRepoJoin, joinPlanRepo } from "./join.js";

/** Ask one question; an empty answer takes the suggestion. */
export type Ask = (question: string, suggestion?: string) => Promise<string>;
/** plan: a company's planning repo, with no story map. spec: a story map for this code. */
export type Kind = "plan" | "spec";

export interface OnboardAnswers {
  kind: Kind;
  dir: string;
  name: string;
  /** A story map's key: the KEY that starts its story ids. */
  key?: string;
  /** A plan's year, e.g. 2027. */
  year?: string;
  pillars?: string[];
  /** The planning repo a code repo joins, e.g. acme/company-plan. */
  planRepo?: string;
  gitInit: boolean;
}

/** The answers the menu takes: 1 or 2, or the word. */
const KINDS: Record<string, Kind> = {
  "1": "plan",
  plan: "plan",
  "2": "spec",
  spec: "spec",
};

/** "Q4 2026", for a date in October to December 2026. */
export const currentQuarter = (d = new Date()) => `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;

/** The person said no at the last question: nothing was set up, and that's fine. */
export class Cancelled extends Error {
  constructor() {
    super("Nothing was set up. Run nikos start again when you're ready.");
  }
}

/** A yes or no question, asked until the answer is one. An empty answer takes the suggestion. */
async function confirm(ask: Ask, question: string, suggestion: "y" | "n"): Promise<boolean> {
  const hint = suggestion === "y" ? "(Y/n)" : "(y/N)";
  let q = `${question} ${hint}`;
  for (let n = 0; n < 3; n++) {
    const a = (await ask(q)).trim().toLowerCase() || suggestion;
    if (/^(y|yes)$/.test(a)) return true;
    if (/^(n|no)$/.test(a)) return false;
    q = `Please type y for yes or n for no. ${question} ${hint}`;
  }
  throw new Error("No yes or no answer, so nothing was set up. Run nikos start again.");
}
const isRepo = (dir: string) => existsSync(join(dir, ".git"));

/** Ask until the answer passes, three times at most. */
async function askUntil(ask: Ask, question: string, suggestion: string | undefined, ok: (a: string) => string | undefined): Promise<string> {
  const first = question;
  for (let n = 0; n < 3; n++) {
    const a = (await ask(question, suggestion)).trim() || suggestion || "";
    const problem = ok(a);
    if (!problem) return a;
    question = `${problem}\n${first}`;
  }
  throw new Error("No usable answer, so nothing was set up. Run nikos start again, or pass --plan or --map with its flags.");
}

/** A comma-separated list; an empty answer is none. */
const listOf = (a: string) =>
  a
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

/** Answers that mean yes or no. To a question that wants a name, they mean the question was misread. */
const YES_OR_NO = /^(y|yes|yeah|yep|ok|okay|sure|n|no|nope)$/i;

/** The menu: what the person is setting up, in two choices. Spec is the suggestion: most people start there. */
const MENU = [
  "What are you setting up?",
  "  1  Plan: the company's goals for a period, in a planning repo of its own. Departments and groups plan under it.",
  "  2  Spec: a story map for this code, with its stories and scenarios, in this repo.",
  "Type 1 or 2",
].join("\n");

export async function askOnboarding(cwd: string, ask: Ask, home = homedir()): Promise<OnboardAnswers> {
  // A repo with intent/ is migrated, not set up again: say so before asking anything.
  if (existsSync(join(cwd, "intent"))) throw new Error("this repo has intent/: move intent/ to maps/<key>/ by hand, as the release notes describe");
  const kind = KINDS[(await askUntil(ask, MENU, "2", (a) => (KINDS[a.toLowerCase()] ? undefined : `'${a}' isn't one of the choices. Please type 1 or 2.`))).toLowerCase()];
  const atHome = resolve(cwd) === resolve(home);
  const name = await askUntil(ask, kind === "plan" ? "What's the company called?" : "What's the product called?", atHome ? undefined : basename(resolve(cwd)), (a) =>
    !a ? "It needs a name." : YES_OR_NO.test(a) ? `'${a}' reads like a yes or no. Type the name instead.` : undefined,
  );

  // Never a home folder, and never on top of another project without a yes.
  const busy = !atHome && readdirSync(cwd).some((f) => !f.startsWith(".")) && !existsSync(join(cwd, "maps")) && !existsSync(join(cwd, "planning"));
  let dir = resolve(cwd);
  if (atHome || (busy && !(await confirm(ask, `This folder already has other files in it:\n  ${resolve(cwd)}\nSet nikOS up in this folder anyway?`, "n")))) {
    const suggestion = slugify(name);
    const folderQuestion = `${atHome ? "You're in your home folder, which isn't a good place for a project, so nikOS will make a new folder for it." : "Then nikOS will make a new folder for it, inside this one."}\nWhat should the new folder be called?`;
    const folder = await askUntil(ask, folderQuestion, suggestion, (a) => {
      // "yes" here meant "yes, make the folder", not a folder called yes.
      if (YES_OR_NO.test(a)) return `'${a}' reads like a yes or no, but this question needs a folder name. Press Enter to use ${suggestion}, or type another name.`;
      const target = resolve(cwd, a);
      if (target === resolve(cwd) || target === resolve(home)) return "That's the folder you're in. Type a name for a new folder.";
      if (existsSync(target) && readdirSync(target).some((f) => !f.startsWith("."))) return `${target} already has files in it. Type another name.`;
      return undefined;
    });
    dir = resolve(cwd, folder);
  }

  let key: string | undefined;
  let planRepo: string | undefined;
  let year: string | undefined;
  let pillars: string[] | undefined;
  if (kind === "spec") {
    const badKey = (a: string) => (KEY.test(a.toUpperCase()) ? undefined : `'${a}' won't work as a key. Use up to 10 letters and digits, starting with a letter.`);
    key = (await askUntil(ask, `Story key: a short code that starts every story id, like ${keyFor(name)}-1. It's hard to change later.`, keyFor(name), badKey)).toUpperCase();
    // A code repo can link to the company's planning repo, once it's on GitHub or GitLab. Enter skips it.
    const repo = (await ask("Is this code part of a company plan? Give its planning repo, like acme/company-plan, or press Enter to skip")).trim();
    if (repo) {
      if (!REPO_PATH.test(repo)) throw new Error(`'${repo}' isn't a repo path. Run nikos start again with a path like acme/company-plan, or leave it out.`);
      planRepo = repo;
    }
  } else {
    year = await askUntil(ask, "Which year are you planning? For example 2027", String(new Date().getFullYear()), (a) => (/^\d{4}$/.test(a) ? undefined : "Type a four-digit year, like 2027."));
    pillars = listOf(await ask("Company pillars, separated by commas. Press Enter to skip"));
  }
  const gitInit = isRepo(dir) ? false : await confirm(ask, "Make it a git repo? Git keeps the history of every change.", "y");

  // Say exactly what will happen, with the full path, before anything is written.
  const where = existsSync(dir) ? `${dir}${dir === resolve(cwd) ? " (this folder)" : ""}` : `${dir} (a new folder)`;
  const summary = [
    "Here's what nikOS will set up:",
    kind === "plan" ? `  A company plan for ${name}, planning ${year}${pillars?.length ? `, pillars ${pillars.join(", ")}` : ""}` : `  A story map for ${name}, story key ${key}${planRepo ? `, linked to the plan in ${planRepo}` : ""}`,
    `  In ${where}`,
    ...(gitInit ? ["  As a new git repo"] : isRepo(dir) ? ["  In the git repo that's already there"] : ["  It won't be a git repo"]),
    "Go ahead?",
  ].join("\n");
  if (!(await confirm(ask, summary, "y"))) throw new Cancelled();
  return {
    kind,
    dir,
    name,
    gitInit,
    ...(key ? { key } : {}),
    ...(year ? { year } : {}),
    ...(pillars?.length ? { pillars } : {}),
    ...(planRepo ? { planRepo } : {}),
  };
}

/** Set it up from the answers. Returns the lines to show. */
export function setUp(a: OnboardAnswers, cwd: string): string[] {
  const out: string[] = [];
  const cli = cliCommand();
  if (!existsSync(a.dir)) {
    mkdirSync(a.dir, { recursive: true });
    out.push(`✓ Made the folder ${a.dir}`);
  }
  if (a.gitInit) {
    const r = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: a.dir, encoding: "utf8" });
    out.push(r.status === 0 ? "✓ Made it a git repo" : `! Couldn't make it a git repo: ${(r.stderr || r.error?.message || "").trim()}`);
  }
  // What to do next, one step per line, in order. Every command can be run as it is.
  const next: string[] = [];
  const cd = a.dir === resolve(cwd) ? "" : `cd ${relative(cwd, a.dir) || a.dir} && `;
  if (a.kind === "plan") {
    const files = initPlanRepo(a.dir, { name: a.name, year: a.year ?? "", pillars: a.pillars });
    out.push(`✓ Made the company's planning repo (${files.map((f) => relative(a.dir, f)).join(", ")})`);
    next.push(`Add a department: ${cli} plan add department <id> --name "<name>"`, `See the plan: ${cd}${cli} plan status`, `Open it in your browser: ${cd}${cli} plan serve`);
  } else {
    const r = start(a.dir, { name: a.name, key: a.key });
    out.push(...r.done.map((d) => `✓ ${d}`), ...r.ask.map((q) => `? ${q}`));
    if (a.planRepo) {
      if (ownRepo(a.dir)) {
        try {
          out.push(describeRepoJoin(joinPlanRepo(a.dir, { plan: a.planRepo })));
        } catch (err) {
          out.push(`! ${(err as Error).message}`);
        }
      } else next.push(`Link it to the company plan: set this repo's origin, then run ${cli} join ${a.planRepo}`);
    }
    next.push(`See it in your browser: ${cd}${cli} serve`);
    next.push('Ask your coding agent to "build the first story", or to plan the product with you.');
  }
  out.push("", "Next steps:");
  out.push(...next.map((line, n) => `  ${n + 1}. ${line}`));
  const stale = staleCliWarning();
  if (stale) out.push("", `! ${stale}`);
  return out;
}
