// The first-run wizard: `nikos start` in a terminal, with no --name. It asks what's being set
// up (a team's product, a company plan, or both), where, and what to call it, one question at
// a time with a suggested answer, then runs start and company init. Agents never see it: they
// pass flags, and the onboard playbook asks the same questions in chat.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { keyFor, slugify } from "./init.js";
import { companyInit, start } from "./start.js";
import { cliCommand, staleCliWarning } from "../lib/cli-version.js";

/** Ask one question; an empty answer takes the suggestion. */
export type Ask = (question: string, suggestion?: string) => Promise<string>;
export type Kind = "team" | "company" | "both";

export interface OnboardAnswers {
  kind: Kind;
  dir: string;
  name: string;
  key?: string;
  period?: string;
  departments?: string[];
  gitInit: boolean;
}

const KINDS: Record<string, Kind> = { "1": "team", team: "team", "2": "company", company: "company", "3": "both", both: "both" };
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
          "  1. A team building a product: a story map, specs as scenarios, and a done gate",
          "  2. A company or department plan: goals, key results and bets that teams plan against",
          "  3. Both, in one repo: a small company with one product team",
          "Choose 1, 2 or 3",
        ].join("\n"),
        "1",
        (a) => (KINDS[a.toLowerCase()] ? undefined : "Please choose 1, 2 or 3."),
      )
    ).toLowerCase()
  ];
  const atHome = resolve(cwd) === resolve(home);
  const name = await askUntil(ask, kind === "team" ? "Product name" : "Company or department name", atHome ? undefined : basename(resolve(cwd)), (a) => (a ? undefined : "It needs a name."));

  // Never a home folder, and never on top of another project without a yes.
  const busy = !atHome && readdirSync(cwd).some((f) => !f.startsWith(".")) && !existsSync(join(cwd, "intent")) && !existsSync(join(cwd, "planning"));
  let dir = resolve(cwd);
  if (atHome || (busy && !(await confirm(ask, `This folder already has files in it (${resolve(cwd)}). Set nikOS up here anyway? (y/N)`, "n")))) {
    const folder = await askUntil(ask, `${atHome ? "Your home folder isn't a good place for a repo. " : ""}Folder to create for it`, slugify(name), (a) => (a ? undefined : "It needs a folder."));
    dir = resolve(cwd, folder);
  }

  const key =
    kind === "company"
      ? undefined
      : (await askUntil(ask, `Story key: every story id starts with it (${keyFor(name)}-1), and it's hard to change later`, keyFor(name), (a) => (KEY.test(a.toUpperCase()) ? undefined : "Letters and digits, starting with a letter, up to 10."))).toUpperCase();
  const period = kind === "team" ? undefined : await askUntil(ask, "Planning period", currentQuarter(), (a) => (a ? undefined : "It needs a period."));
  const departments =
    kind === "company"
      ? (await ask("Departments or teams that will plan against it, separated by commas (Enter to skip)", ""))
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean)
      : undefined;
  const gitInit = isRepo(dir) ? false : await confirm(ask, "Make it a git repo? (Y/n)", "y");
  return { kind, dir, name, gitInit, ...(key ? { key } : {}), ...(period ? { period } : {}), ...(departments?.length ? { departments } : {}) };
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
  if (a.kind !== "company") {
    const r = start(a.dir, { name: a.name, key: a.key });
    out.push(...r.done.map((d) => `✓ ${d}`), ...r.ask.map((q) => `? ${q}`));
  }
  if (a.kind !== "team") {
    const r = companyInit(a.dir, { name: a.name, period: a.period, departments: a.departments });
    out.push(`✓ Wrote the ${a.kind === "both" ? "company plan beside the story map" : "company plan"} (${r.created.join(", ") || "already there"})`);
    if (a.kind === "company") out.push(`  Departments and teams join it with: ${r.join}`);
  }
  const cd = a.dir === resolve(cwd) ? "" : `cd ${relative(cwd, a.dir) || a.dir} && `;
  out.push("", `See it: ${cd}${cliCommand()} serve`);
  const stale = staleCliWarning();
  if (stale) out.push(`! ${stale}`);
  out.push(
    a.kind === "team"
      ? 'Then ask your coding agent to "build the first story", or to plan the product with you.'
      : 'Then ask your coding agent to "plan this quarter\'s objectives and key results".',
  );
  return out;
}
