import { store } from "../lib/store.js";
import { join } from "node:path";
import { STORY_ID, findIntentDir, read } from "../lib/project.js";
import { formatResult, validate } from "./validate.js";

const CATEGORIES = ["product", "architecture", "design", "interface", "process"];

export interface DecisionInput {
  title: string;
  why: string;
  story?: string;
  category?: string;
  supersedes?: string;
  date?: string;
}

/** Append a dated entry to decisions.md. Earlier entries are never touched. */
export function decide(input: DecisionInput, dir: string): string {
  const title = input.title.trim();
  if (!title) throw new Error("A decision needs a title");
  if (!input.why.trim()) throw new Error("Say why: what you chose and what you rejected (--why)");
  if (input.story && !STORY_ID.test(input.story)) throw new Error(`'${input.story}' is not a story id (expected e.g. HT-1)`);
  const category = input.category ?? "architecture";
  if (!CATEGORIES.includes(category)) throw new Error(`Category must be one of ${CATEGORIES.join(", ")}`);
  const path = join(findIntentDir(dir), "decisions.md");
  if (!store().exists(path)) throw new Error("No intent/decisions.md. Run `nikos init` first.");

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
  const dir = opt("dir") ?? process.cwd();
  try {
    decide({ title, why: opt("why") ?? "", story: opt("story"), category: opt("category"), supersedes: opt("supersedes") }, dir);
    console.log(`Added to decisions.md: ${title}`);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
  const v = validate(dir);
  if (v.errors.length) {
    console.error(formatResult(v));
    return 1;
  }
  return 0;
}
