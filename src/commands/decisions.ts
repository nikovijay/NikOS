import { existsSync } from "node:fs";
import { join } from "node:path";
import { findIntentDir, read } from "../lib/project.js";

export interface DecisionEntry {
  /** First and last line of the entry in decisions.md, 1-based. */
  start: number;
  end: number;
  title: string;
  text: string;
}

const STOP = new Set(["the", "and", "for", "why", "did", "was", "were", "are", "you", "how", "what", "with", "this", "that", "not", "use", "using", "instead", "of", "we", "our", "decide", "decided", "choose", "chose", "rather", "than"]);

/** Every "## " entry in decisions.md, with its line range. HTML comments are skipped. */
export function decisionEntries(dir: string): DecisionEntry[] {
  const path = join(findIntentDir(dir), "decisions.md");
  if (!existsSync(path)) return [];
  const lines = read(path).split("\n");
  const entries: DecisionEntry[] = [];
  let inComment = false;
  let current: DecisionEntry | undefined;
  lines.forEach((line, i) => {
    if (line.trim().startsWith("<!--")) inComment = true;
    const commented = inComment;
    if (line.includes("-->")) inComment = false;
    if (commented) return;
    if (line.startsWith("## ")) {
      current = { start: i + 1, end: i + 1, title: line.slice(3).trim(), text: line };
      entries.push(current);
    } else if (current && !line.startsWith("# ")) {
      current.text += `\n${line}`;
      if (line.trim()) current.end = i + 1;
    }
  });
  for (const e of entries) e.text = e.text.trimEnd();
  return entries;
}

export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** Entries that mention the query, best match first. Entries matching under half as many terms as the best are dropped. */
export function findDecisions(query: string, dir: string): DecisionEntry[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const scored = decisionEntries(dir)
    .map((e) => {
      const text = e.text.toLowerCase();
      return { e, hits: terms.filter((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(text)).length };
    })
    .filter((m) => m.hits > 0);
  const best = Math.max(0, ...scored.map((m) => m.hits));
  return scored
    .filter((m) => m.hits * 2 >= best)
    .sort((a, b) => b.hits - a.hits || a.e.start - b.e.start)
    .map((m) => m.e);
}

export function formatDecisions(query: string, found: DecisionEntry[]): string {
  if (!found.length) return `No decision in intent/decisions.md mentions "${query}".`;
  return found.map((e) => `intent/decisions.md:${e.start}-${e.end}\n${e.text}`).join("\n\n");
}

export function runDecisions(args: string[]): number {
  const i = args.indexOf("--dir");
  const dir = i >= 0 ? args[i + 1] : process.cwd();
  const query = (i >= 0 ? [...args.slice(0, i), ...args.slice(i + 2)] : args).join(" ").trim();
  if (!query) {
    console.error('Usage: nikos decisions "<topic or story id>" [--dir <path>]');
    return 1;
  }
  console.log(formatDecisions(query, findDecisions(query, dir)));
  return 0;
}
