// The first-run wizard: `nikos start` in a terminal, with no --name. It asks which level is being
// set up (a company, a department or a team), where, and what to call it, one question at a time
// with a suggested answer, then writes it. Company and department plans have no story map; a
// team has its own plan and the story map that specs its bets into stories. Agents never see the
// wizard: they pass flags, and the onboard playbook asks the same questions in chat.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { keyFor, slugify } from "./init.js";
import { companyInit, start, teamPlan } from "./start.js";
import { cliCommand, staleCliWarning } from "../lib/cli-version.js";

/** Ask one question; an empty answer takes the suggestion. */
export type Ask = (question: string, suggestion?: string) => Promise<string>;
export type Kind = "company" | "department" | "team";

export interface OnboardAnswers {
  kind: Kind;
  dir: string;
  name: string;
  key?: string;
  period?: string;
  departments?: string[];
  /** The plan above this one, as its repo path, to join once it's pushed. */
  joins?: string;
  gitInit: boolean;
}

const KINDS: Record<string, Kind> = { "1": "company", company: "company", "2": "department", department: "department", "3": "team", team: "team" };
const KEY = /^[A-Z][A-Z0-9]{0,9}$/;

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

export async function askOnboarding(cwd: string, ask: Ask, home = homedir()): Promise<OnboardAnswers> {
  const kind = KINDS[
    (
      await askUntil(
        ask,
        [
          "What are you setting up?",
          "  1. A company plan: objectives, key results and bets that departments and teams plan against",
          "  2. A department plan: its key results and bets, aligned to the company's",
          "  3. A team: its key results and bets, and a story map that specs each bet into stories",
          "Choose 1, 2 or 3",
        ].join("\n"),
        "3",
        (a) => (KINDS[a.toLowerCase()] ? undefined : "Please choose 1, 2 or 3."),
      )
    ).toLowerCase()
  ];
  const atHome = resolve(cwd) === resolve(home);
  const name = await askUntil(ask, { company: "Company name", department: "Department name", team: "Team name" }[kind], atHome ? undefined : basename(resolve(cwd)), (a) => (a ? undefined : "It needs a name."));

  // Never a home folder, and never on top of another project without a yes.
  const busy = !atHome && readdirSync(cwd).some((f) => !f.startsWith(".")) && !existsSync(join(cwd, "intent")) && !existsSync(join(cwd, "planning"));
  let dir = resolve(cwd);
  if (atHome || (busy && !(await confirm(ask, `This folder already has files in it (${resolve(cwd)}). Set nikOS up here anyway? (y/N)`, "n")))) {
    const folder = await askUntil(ask, `${atHome ? "Your home folder isn't a good place for a repo. " : ""}Folder to create for it`, slugify(name), (a) => (a ? undefined : "It needs a folder."));
    dir = resolve(cwd, folder);
  }

  const key =
    kind !== "team"
      ? undefined
      : (await askUntil(ask, `Story key: every story id starts with it (${keyFor(name)}-1), and it's hard to change later`, keyFor(name), (a) => (KEY.test(a.toUpperCase()) ? undefined : "Letters and digits, starting with a letter, up to 10."))).toUpperCase();
  const period = await askUntil(ask, "Planning period", currentQuarter(), (a) => (a ? undefined : "It needs a period."));
  const departments =
    kind === "team"
      ? undefined
      : (await ask(`${kind === "company" ? "Departments" : "Teams"} that will plan against it, separated by commas (Enter to skip)`, ""))
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
  const joins =
    kind === "company"
      ? undefined
      : (await ask(`The ${kind === "team" ? "department or company" : "company"} plan it works toward, as its repo path, e.g. acme/company-plan (Enter to skip)`, "")).trim() || undefined;
  const gitInit = isRepo(dir) ? false : await confirm(ask, "Make it a git repo? (Y/n)", "y");
  return { kind, dir, name, gitInit, period, ...(key ? { key } : {}), ...(departments?.length ? { departments } : {}), ...(joins ? { joins } : {}) };
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
  if (a.kind === "team") {
    const r = start(a.dir, { name: a.name, key: a.key });
    const plan = teamPlan(a.dir, { name: a.name, period: a.period });
    out.push(...r.done.map((d) => `✓ ${d}`), `✓ ${plan.length ? "Wrote the team's plan beside its story map" : "The team's plan is already there"} (planning/)`, ...r.ask.map((q) => `? ${q}`));
  } else {
    const r = companyInit(a.dir, { name: a.name, period: a.period, departments: a.departments, level: a.kind });
    out.push(`✓ Wrote the ${a.kind} plan (${r.created.join(", ") || "already there"}). It has no story map: teams spec their bets into stories in their own repos.`);
    out.push(`  ${a.kind === "company" ? "Departments and teams" : "Its teams"} join it with: ${r.join}`);
  }
  if (a.joins) out.push(`  Once ${a.joins} is reachable from here, link this plan to it with: ${cliCommand()} join ${a.joins}`);
  const cd = a.dir === resolve(cwd) ? "" : `cd ${relative(cwd, a.dir) || a.dir} && `;
  const stale = staleCliWarning();
  if (stale) out.push(`! ${stale}`);
  out.push("", `See it: ${cd}${cliCommand()} serve`);
  out.push(
    a.kind === "team"
      ? 'Then ask your coding agent to "plan this quarter\'s key results and bets", and to spec the first bet into stories.'
      : 'Then ask your coding agent to "plan this quarter\'s objectives and key results".',
  );
  return out;
}
