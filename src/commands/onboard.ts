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

/** A yes or no question; an empty answer takes the suggestion. */
const confirm = async (ask: Ask, question: string, suggestion: "y" | "n") => !/^n/i.test((await ask(question, suggestion)).trim() || suggestion);
const isRepo = (dir: string) => existsSync(join(dir, ".git"));

/** Ask until the answer passes, three times at most. */
async function askUntil(ask: Ask, question: string, suggestion: string | undefined, ok: (a: string) => string | undefined): Promise<string> {
  for (let n = 0; n < 3; n++) {
    const a = (await ask(question, suggestion)).trim() || suggestion || "";
    const problem = ok(a);
    if (!problem) return a;
    question = `${problem} ${question}`;
  }
  throw new Error("No usable answer, so nothing was set up. Run nikos start again, or pass --name and --key.");
}

/** A comma-separated list; an empty answer is none. */
const listOf = (a: string) =>
  a
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

/** The menu: what the person is setting up, in six choices. */
const MENU = [
  "What are you setting up?",
  "  1 A company plan: the company's objectives, key results and bets. Departments or groups plan below it.",
  "  2 A department plan: a department's objectives, aligned to the company plan.",
  "  3 A group: its plan and story maps for its bets. The group can be its own team.",
  "  4 A team repo that joins a group, which owns its story maps.",
  "  5 One product in one repo, with its own story map in intent/ (the single-repo path, no levels).",
  "  6 Both: a company plan and a product repo (older path).",
  "Choose 1 to 6",
].join("\n");

export async function askOnboarding(cwd: string, ask: Ask, home = homedir()): Promise<OnboardAnswers> {
  const kind = KINDS[(await askUntil(ask, MENU, "5", (a) => (KINDS[a.toLowerCase()] ? undefined : "Please choose 1 to 6.")) ).toLowerCase()];
  // A team repo that already keeps a story map can't also be a team; checked before any other question.
  if (kind === "team" && (existsSync(join(cwd, "intent")) || existsSync(join(cwd, "maps")))) {
    throw new Error("this repo has its own story map (intent/ or maps/), and a team repo can't hold one. Move it to a group repo with nikos migrate maps, or pick another option");
  }
  const atHome = resolve(cwd) === resolve(home);
  const label = {
    company: "Company or department name",
    department: "Company or department name",
    group: "Group name",
    team: "Team name",
    product: "Product name",
    both: "Company or department name",
  }[kind];
  const name = await askUntil(ask, label, atHome ? undefined : basename(resolve(cwd)), (a) => (a ? undefined : "It needs a name."));

  // Never a home folder, and never on top of another project without a yes.
  const busy = !atHome && readdirSync(cwd).some((f) => !f.startsWith(".")) && !existsSync(join(cwd, "intent")) && !existsSync(join(cwd, "planning"));
  let dir = resolve(cwd);
  if (atHome || (busy && !(await confirm(ask, `This folder already has files in it (${resolve(cwd)}). Set nikOS up here anyway? (y/N)`, "n")))) {
    const folder = await askUntil(ask, `${atHome ? "Your home folder isn't a good place for a repo. " : ""}Folder to create for it`, slugify(name), (a) => (a ? undefined : "It needs a folder."));
    dir = resolve(cwd, folder);
  }

  // Only a product and a group have a key: a product's story ids, or a group's (PAY-HT-1 in the group PAY).
  const key =
    kind === "product" || kind === "both"
      ? (await askUntil(ask, `Story key: every story id starts with it (${keyFor(name)}-1), and it's hard to change later`, keyFor(name), (a) => (KEY.test(a.toUpperCase()) ? undefined : "Letters and digits, starting with a letter, up to 10."))).toUpperCase()
      : kind === "group"
        ? (await askUntil(ask, "The group's key is the prefix of every story id in its maps (PAY-HT-1). Letters and numbers, starting with a letter.", keyFor(name), (a) => (KEY.test(a.toUpperCase()) ? undefined : "Letters and digits, starting with a letter, up to 10."))).toUpperCase()
        : undefined;
  const period = kind === "team" || kind === "product" ? undefined : await askUntil(ask, "Planning period", currentQuarter(), (a) => (a ? undefined : "It needs a period."));

  let departments: string[] | undefined;
  let groupsDirect = false;
  if (kind === "company") {
    if (await confirm(ask, "Do departments report to this company? (Y/n)", "y")) departments = listOf(await ask("Departments that will plan against it, separated by commas (Enter to skip)", ""));
    else {
      groupsDirect = true;
      departments = listOf(await ask("Groups that will plan against it, separated by commas (Enter to skip)", ""));
    }
  }
  const sameTeam = kind === "group" ? await confirm(ask, "Is this repo also the team that builds it? (Y/n)", "y") : undefined;
  const group = kind === "team" ? listOf(await ask("The group repo this team takes work from, e.g. acme/checkout-group (Enter to skip)", ""))[0] : undefined;
  const gitInit = isRepo(dir) ? false : await confirm(ask, "Make it a git repo? (Y/n)", "y");
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
  if (!existsSync(a.dir)) {
    mkdirSync(a.dir, { recursive: true });
    out.push(`✓ Created ${relative(cwd, a.dir) || a.dir}`);
  }
  if (a.gitInit) {
    const r = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: a.dir, encoding: "utf8" });
    out.push(r.status === 0 ? "✓ Made it a git repo" : `! Couldn't run git init: ${(r.stderr || r.error?.message || "").trim()}`);
  }
  if (a.kind === "product" || a.kind === "both") {
    const r = start(a.dir, { name: a.name, key: a.key });
    out.push(...r.done.map((d) => `✓ ${d}`), ...r.ask.map((q) => `? ${q}`));
  }
  if (a.kind === "team") {
    const repo = ownRepo(a.dir) ?? `local/${slugify(basename(a.dir))}`;
    teamInit(a.dir, { name: a.name, repo });
    out.push(`✓ Made ${a.name} a team repo (${TEAM_FILE}, ${repo})`);
    if (!ownRepo(a.dir)) out.push(`! No origin remote yet: set the repo's path with nikos team init --repo owner/repo, once it has one`);
    if (a.group) {
      const j = teamJoin(a.dir, a.group);
      out.push(j.unresolved ? `! ${a.group} isn't reachable yet (${j.unresolved}): it's kept, and nikos sync fetches it once it is` : `✓ Takes work from ${a.group}`);
    } else out.push("Join a group later with nikos team join <group repo>.");
  }
  if (a.kind !== "product" && a.kind !== "team") {
    const level = a.kind === "both" ? "company" : a.kind;
    const r = companyInit(a.dir, { name: a.name, key: a.kind === "group" ? a.key : undefined, period: a.period, departments: a.departments, level, groupsDirect: a.groupsDirect });
    if (a.kind === "both") out.push(`✓ Wrote the company plan beside the story map (${r.created.join(", ") || "already there"})`);
    else out.push(`✓ Wrote the ${a.kind} plan (${r.created.join(", ") || "already there"})`);
    if (a.kind === "company") out.push(`  ${a.groupsDirect ? "Groups" : "Departments"} and teams join it with: ${r.join}`);
    if (a.kind === "department") out.push(`  Link it to the company plan with: ${cliCommand()} join <repo path of the company plan>`);
    if (a.kind === "group") {
      if (a.sameTeam) {
        out.push(`  The group's key is ${r.key}. Its smallest setup, in this repo:`, `    ${cliCommand()} planning bet new <bet-id>`, `    ${cliCommand()} map new --bet <bet-id> --key <MAP>`, `    ${cliCommand()} assign "${a.name}" --repo .`);
      } else out.push(`  Teams join later with nikos team init in each team repo, then nikos team join.`);
      out.push(`  Link it to the department or company plan above with: ${cliCommand()} join <repo path of that plan>`);
    }
  }
  if (a.kind === "product" || a.kind === "both") out.push("A group with teams plans and shares maps across repos. nikos migrate maps moves an intent/ story map into one.");
  const cd = a.dir === resolve(cwd) ? "" : `cd ${relative(cwd, a.dir) || a.dir} && `;
  out.push("", `See it: ${cd}${cliCommand()} serve`);
  const stale = staleCliWarning();
  if (stale) out.push(`! ${stale}`);
  out.push(
    a.kind === "product" || a.kind === "both"
      ? 'Then ask your coding agent to "build the first story", or to plan the product with you.'
      : a.kind === "team"
        ? 'Then ask your coding agent to "build the next assigned story".'
        : a.kind === "group"
          ? 'Then ask your coding agent to "plan this quarter\'s bets for the group".'
          : 'Then ask your coding agent to "plan this quarter\'s objectives and key results".',
  );
  return out;
}
