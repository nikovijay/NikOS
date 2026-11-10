import { relative } from "node:path";
import { store } from "../lib/store.js";
import { STORY_ID, decisionsPath, read } from "../lib/project.js";
import { formatResult, validate, validateGroup } from "./validate.js";
import { mapDirs } from "../lib/maps.js";
import { isPlanRepo } from "../planning/model.js";
import { areaFor, findArea, findPlanRepo } from "../plan/repo.js";

const PLAN_DECISIONS = `# Decisions

What this plan decided and why, newest last. Add one with \`nikos decide\`; earlier entries are never edited.
`;

const CATEGORIES = ["product", "architecture", "design", "interface", "process"];

export interface DecisionInput {
  title: string;
  why: string;
  story?: string;
  category?: string;
  supersedes?: string;
  date?: string;
  /** In a planning repo: the area whose decisions.md gets it, as people write it (finance, departments/finance). The company's by default. */
  area?: string;
}

/** Append a dated entry to decisions.md. Earlier entries are never touched. */
export function decide(input: DecisionInput, dir: string): string {
  const title = input.title.trim();
  if (!title) throw new Error("A decision needs a title");
  if (!input.why.trim()) throw new Error("Say why: what you chose and what you rejected (--why)");
  if (input.story && !STORY_ID.test(input.story)) throw new Error(`'${input.story}' is not a story id (expected e.g. HT-1 or PAY-CHK-12)`);
  const category = input.category ?? "architecture";
  if (!CATEGORIES.includes(category)) throw new Error(`Category must be one of ${CATEGORIES.join(", ")}`);
  const planRepo = isPlanRepo(dir);
  if (input.area && !planRepo) throw new Error("--in names an area of a planning repo, and this isn't one");
  const path = decisionsPath(dir, planRepo ? findArea(dir, input.area ?? "company").rel : undefined);
  if (!store().exists(path)) {
    if (!planRepo && !mapDirs(dir).length) throw new Error("No decisions.md. Run `nikos init` first.");
    store().write(path, PLAN_DECISIONS, { create: true });
  }

  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const entry = [
    `## ${date} — ${title}${input.story ? ` (${input.story})` : ""}`,
    `**Category:** ${category}`,
    `**Supersedes:** ${input.supersedes ?? "none"}`,
    "",
    input.why.trim(),
    "",
  ].join("\n");
  const existing = read(path);
  const gap = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  store().append(path, gap + entry);
  return entry;
}

export function runDecide(args: string[]): number {
  const [title, ...rest] = args;
  const opt = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (!title || title.startsWith("--")) {
    console.error('Usage: nikos decide "<title>" --why "<why>" [--story <id>] [--category product|architecture|design|interface|process] [--supersedes "<title>"]');
    return 1;
  }
  const cwd = opt("dir") ?? process.cwd();
  // In a planning repo, the decision goes to the area named with --in, or the folder you're in, else the company.
  const repo = findPlanRepo(cwd);
  const dir = repo ?? cwd;
  try {
    const area = repo ? (opt("in") ?? areaFor(repo, undefined, cwd)?.rel) : opt("in");
    decide({ title, why: opt("why") ?? "", story: opt("story"), category: opt("category"), supersedes: opt("supersedes"), area }, dir);
    const shown = repo ? decisionsPath(dir, findArea(repo, area ?? "company").rel) : decisionsPath(dir);
    console.log(`Added to ${relative(dir, shown)}: ${title}`);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
  if (repo || !mapDirs(dir).length) return 0; // no story map to check
  const v = mapDirs(dir).length ? validateGroup(dir) : validate(dir);
  if (v.errors.length) {
    console.error(formatResult(v));
    return 1;
  }
  return 0;
}
