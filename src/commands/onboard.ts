// The first-run wizard: `nikos start` in a terminal, with no --name. It asks what's being set up
// (a company, department or group plan, a team repo that joins a group, or a product's own repo,
// with or without a company plan), where, and what to call it, one question at a time with a
// suggested answer, then runs the matching setup. Agents never see it: they pass flags, and the
// onboard playbook asks the same questions in chat.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { keyFor, slugify } from "./init.js";
import { companyInit, start } from "./start.js";
import { teamInit, teamJoin } from "./team.js";
import { cliCommand, staleCliWarning } from "../lib/cli-version.js";
import { ownRepo } from "../lib/git.js";
import { TEAM_FILE } from "../lib/team.js";
import { KEY } from "../lib/keys.js";

/** Ask one question; an empty answer takes the suggestion. */
export type Ask = (question: string, suggestion?: string) => Promise<string>;
/** company, department and group are plans; team is a team repo that joins a group; product is one repo with its own story map; both is a company plan beside a product. */
export type Kind = "company" | "department" | "group" | "team" | "product" | "both";

export interface OnboardAnswers {
  kind: Kind;
  dir: string;
  name: string;
  /** A product's story key, or a group's key (the GROUP in its story ids). */
  key?: string;
  period?: string;
  departments?: string[];
  /** A company with groups listed directly, when no departments sit between it and the groups. */
  groupsDirect?: boolean;
  /** A group that is its own team: assigned with --repo . */
  sameTeam?: boolean;
  /** A team repo's group repo, to join now. */
  group?: string;
  gitInit: boolean;
}

/** The answers the menu takes: 1 to 6, the word for each, and the older names. `team` is the old name of a product. */
const KINDS: Record<string, Kind> = {
  "1": "company",
  company: "company",
  "2": "department",
  department: "department",
  "3": "group",
  group: "group",
  "4": "team",
  repo: "team",
  "team repo": "team",
  "5": "product",
  product: "product",
  team: "product",
  "6": "both",
  both: "both",
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
  throw new Error("No usable answer, so nothing was set up. Run nikos start again, or pass --name and --key.");
}

/** A comma-separated list; an empty answer is none. */
const listOf = (a: string) =>
  a
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

/** Answers that mean yes or no. To a question that wants a name, they mean the question was misread. */
const YES_OR_NO = /^(y|yes|yeah|yep|ok|okay|sure|n|no|nope)$/i;

/** The menu: what the person is setting up, in six choices. */
const MENU = [
  "What are you setting up?",
  "  1  A company plan: the company's goals for a period. Departments or groups plan under it.",
  "  2  A department plan: a department's goals, under a company plan.",
  "  3  A group: bets, and the story maps that deliver them. It can be its own team.",
  "  4  A team repo that takes its work from a group.",
  "  5  One product in one repo, with its own story map. Pick this if you're not sure.",
  "  6  A company plan and a product, in the same repo.",
  "Type a number from 1 to 6",
].join("\n");

/** What each choice makes, for the summary before anything is written. */
const WHAT: Record<Kind, string> = {
  company: "A company plan",
  department: "A department plan",
  group: "A group plan",
  team: "A team repo",
  product: "A product with its own story map",
  both: "A company plan and a product story map",
};

export async function askOnboarding(cwd: string, ask: Ask, home = homedir()): Promise<OnboardAnswers> {
  const kind = KINDS[(await askUntil(ask, MENU, "5", (a) => (KINDS[a.toLowerCase()] ? undefined : `'${a}' isn't one of the choices. Please type a number from 1 to 6.`))).toLowerCase()];
  // A team repo that already keeps a story map can't also be a team; checked before any other question.
  if (kind === "team" && (existsSync(join(cwd, "intent")) || existsSync(join(cwd, "maps")))) {
    throw new Error("this folder already has a story map (intent/ or maps/), and a team repo can't hold one. Pick another option, or move the map to a group repo with nikos migrate maps");
  }
  const atHome = resolve(cwd) === resolve(home);
  const label = {
    company: "What's the company called?",
    department: "What's the department called?",
    group: "What's the group called?",
    team: "What's the team called?",
    product: "What's the product called?",
    both: "What's the company called?",
  }[kind];
  const name = await askUntil(ask, label, atHome ? undefined : basename(resolve(cwd)), (a) =>
    !a ? "It needs a name." : YES_OR_NO.test(a) ? `'${a}' reads like a yes or no. Type the name instead.` : undefined,
  );

  // Never a home folder, and never on top of another project without a yes.
  const busy = !atHome && readdirSync(cwd).some((f) => !f.startsWith(".")) && !existsSync(join(cwd, "intent")) && !existsSync(join(cwd, "planning"));
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

  // Only a product and a group have a key: a product's story ids, or a group's (PAY-HT-1 in the group PAY).
  const badKey = (a: string) => (KEY.test(a.toUpperCase()) ? undefined : `'${a}' won't work as a key. Use up to 10 letters and digits, starting with a letter.`);
  const key =
    kind === "product" || kind === "both"
      ? (await askUntil(ask, `Story key: a short code that starts every story id, like ${keyFor(name)}-1. It's hard to change later.`, keyFor(name), badKey)).toUpperCase()
      : kind === "group"
        ? (await askUntil(ask, "Group key: a short code that starts every story id in the group's maps, like PAY-HT-1. It's hard to change later.", keyFor(name), badKey)).toUpperCase()
        : undefined;
  const period = kind === "team" || kind === "product" ? undefined : await askUntil(ask, "Which period are you planning? For example Q1 2027, or 2027", currentQuarter(), (a) => (a ? undefined : "It needs a period."));

  let departments: string[] | undefined;
  let groupsDirect = false;
  if (kind === "company") {
    if (await confirm(ask, "Do departments plan under this company?", "y")) departments = listOf(await ask("Name the departments, separated by commas. Press Enter to skip", ""));
    else {
      groupsDirect = true;
      departments = listOf(await ask("Name the groups that plan under it, separated by commas. Press Enter to skip", ""));
    }
  }
  const sameTeam = kind === "group" ? await confirm(ask, "Will the group's own team build its stories, in this repo?", "y") : undefined;
  const group = kind === "team" ? listOf(await ask("Which group repo does this team take work from? For example acme/checkout-group. Press Enter to skip", ""))[0] : undefined;
  const gitInit = isRepo(dir) ? false : await confirm(ask, "Make it a git repo? Git keeps the history of every change.", "y");

  // Say exactly what will happen, with the full path, before anything is written.
  const where = existsSync(dir) ? `${dir}${dir === resolve(cwd) ? " (this folder)" : ""}` : `${dir} (a new folder)`;
  const summary = [
    "Here's what nikOS will set up:",
    `  ${WHAT[kind]} for ${name}${period ? `, planning ${period}` : ""}${key ? `, story key ${key}` : ""}`,
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
    ...(period ? { period } : {}),
    ...(departments?.length ? { departments } : {}),
    ...(groupsDirect ? { groupsDirect } : {}),
    ...(sameTeam !== undefined ? { sameTeam } : {}),
    ...(group ? { group } : {}),
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
  next.push(`See it in your browser: ${cd}${cli} serve`);
  if (a.kind === "product" || a.kind === "both") {
    const r = start(a.dir, { name: a.name, key: a.key });
    out.push(...r.done.map((d) => `✓ ${d}`), ...r.ask.map((q) => `? ${q}`));
  }
  if (a.kind === "team") {
    const own = ownRepo(a.dir);
    const repo = own ?? `local/${slugify(basename(a.dir))}`;
    teamInit(a.dir, { name: a.name, repo });
    out.push(`✓ Made ${a.name} a team repo (${TEAM_FILE})`);
    if (!own) next.push(`Put this repo on GitHub or GitLab. Then tell nikOS its path with ${cli} team init --repo and the path, like ${cli} team init --repo acme/${slugify(basename(a.dir))}`);
    if (a.group) {
      const j = teamJoin(a.dir, a.group);
      out.push(j.unresolved ? `! Couldn't reach ${a.group} yet (${j.unresolved}). It's saved, and ${cli} sync fetches its work once it can.` : `✓ Takes work from ${a.group}`);
    } else next.push(`Link it to its group: ${cli} team join and the group repo's path, like ${cli} team join acme/checkout-group`);
  }
  if (a.kind !== "product" && a.kind !== "team") {
    const level = a.kind === "both" ? "company" : a.kind;
    const r = companyInit(a.dir, { name: a.name, key: a.kind === "group" ? a.key : undefined, period: a.period, departments: a.departments, level, groupsDirect: a.groupsDirect });
    const files = r.created.join(", ") || "it was already there";
    out.push(a.kind === "both" ? `✓ Wrote the company plan next to the story map (${files})` : `✓ Wrote the ${a.kind} plan (${files})`);
    const below = a.kind === "group" ? "Teams" : a.groupsDirect ? "Groups" : "Departments";
    if (a.kind === "company" || a.kind === "both") {
      next.push(r.join ? `${below} join it with: ${r.join}` : `${isRepo(a.dir) ? "Put this repo" : "Make it a git repo and put it"} on GitHub or GitLab. ${below} then join it with ${cli} join and this repo's path.`);
    }
    if (a.kind === "department") next.push(`Link it to the company plan: ${cli} join and the company plan's repo path, like ${cli} join acme/company-plan`);
    if (a.kind === "group") {
      if (a.sameTeam) {
        next.push(
          `Make a bet, a story map for it, and give the map to this repo's team. Use your own names in place of faster-checkout and CHK:`,
          `     ${cli} planning bet new faster-checkout`,
          `     ${cli} map new --bet faster-checkout --key CHK`,
          `     ${cli} assign "${a.name}" --repo .`,
        );
      } else next.push(`Teams join later: each team runs ${cli} team init in its own repo, then ${cli} team join with this repo's path.`);
      next.push(`Link it to the plan above: ${cli} join and that plan's repo path, like ${cli} join acme/payments-plan`);
    }
  }
  next.push(
    a.kind === "product" || a.kind === "both"
      ? 'Ask your coding agent to "build the first story", or to plan the product with you.'
      : a.kind === "team"
        ? 'Ask your coding agent to "build the next assigned story".'
        : a.kind === "group"
          ? 'Ask your coding agent to "plan this period\'s bets for the group".'
          : 'Ask your coding agent to "plan this period\'s objectives and key results".',
  );
  if (a.kind === "product" || a.kind === "both") next.push(`Later, if teams across several repos share story maps, ${cli} migrate maps moves this story map into a group.`);
  out.push("", "Next steps:");
  let n = 0;
  for (const line of next) out.push(line.startsWith("     ") ? line : `  ${++n}. ${line}`);
  const stale = staleCliWarning();
  if (stale) out.push("", `! ${stale}`);
  return out;
}
