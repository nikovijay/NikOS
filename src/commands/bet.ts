import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Document, parse } from "yaml";
import { STORY_ID, findIntentDir, read } from "../lib/project.js";

export const BET_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface BetInput {
  id: string;
  hypothesis: string;
  keyResult: string;
  expectedUplift: string;
  timeBox: string;
  stories: string[];
  blockers?: string[];
}

/** Story ids in any release of storymap.yaml, or undefined if there is no story map. */
function mapStories(intentDir: string): Set<string> | undefined {
  const path = join(intentDir, "storymap.yaml");
  if (!existsSync(path)) return undefined;
  const map = parse(read(path));
  return new Set((map?.releases ?? []).flatMap((r: any) => r?.stories ?? []));
}

/** Split a bet card into its front matter and body. */
export function parseBet(text: string): { meta: any; body: string } | undefined {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return undefined;
  return { meta: parse(m[1]), body: text.slice(m[0].length) };
}

/** Write intent/bets/<id>.md with every field filled in, linked to stories that exist. */
export function newBet(input: BetInput, dir: string): string {
  if (!BET_ID.test(input.id)) throw new Error(`'${input.id}' is not a bet id (lowercase words joined by hyphens, e.g. faster-payment)`);
  const fields: [string, string][] = [
    ["hypothesis", input.hypothesis],
    ["key result (--kr)", input.keyResult],
    ["expected uplift (--uplift)", input.expectedUplift],
  ];
  for (const [name, value] of fields) if (!value?.trim()) throw new Error(`A bet needs a ${name}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.timeBox ?? "")) throw new Error("A bet needs a time box end date (--time-box YYYY-MM-DD)");
  if (!input.stories.length) throw new Error("A bet needs at least one story (--story <id>)");
  const bad = input.stories.filter((s) => !STORY_ID.test(s));
  if (bad.length) throw new Error(`Not story ids: ${bad.join(", ")} (expected e.g. HT-1)`);

  const intentDir = findIntentDir(dir);
  const known = mapStories(intentDir);
  const unknown = known ? input.stories.filter((s) => !known.has(s)) : [];
  if (unknown.length) throw new Error(`Not in storymap.yaml: ${unknown.join(", ")}`);

  const meta = {
    id: input.id,
    hypothesis: input.hypothesis.trim(),
    key_result: input.keyResult.trim(),
    expected_uplift: input.expectedUplift.trim(),
    time_box: input.timeBox,
    blockers: input.blockers ?? [],
    stories: [...new Set(input.stories)],
    status: "open",
  };
  const body = "\n## Why we think so\nThe evidence behind the hypothesis.\n\n## Outcome\nFilled in when the time box ends: the key result as measured, and won, lost or killed.\n";
  const path = join(intentDir, "bets", `${input.id}.md`);
  mkdirSync(dirname(path), { recursive: true });
  // "wx" fails if the file exists, so an existing bet is never overwritten.
  try {
    const doc = new Document(meta);
    for (const key of ["blockers", "stories"]) (doc.get(key, true) as any).flow = true;
    writeFileSync(path, `---\n${doc.toString({ flowCollectionPadding: false, lineWidth: 0 })}---\n${body}`, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`A bet called '${input.id}' already exists`);
    throw err;
  }
  return path;
}

export function runBet(args: string[]): number {
  const [sub, id, ...rest] = args;
  const all = (n: string) => rest.flatMap((a, i) => (a === `--${n}` && rest[i + 1] !== undefined ? [rest[i + 1]] : []));
  const opt = (n: string) => all(n)[0];
  if (sub !== "new" || !id || id.startsWith("--")) {
    console.error(
      'Usage: nikos bet new <bet-id> --hypothesis "<…>" --kr "<key result>" --uplift "<expected uplift>" --time-box YYYY-MM-DD --story <id> [--story <id>] [--blocker "<…>"]',
    );
    return 1;
  }
  try {
    const path = newBet(
      {
        id,
        hypothesis: opt("hypothesis") ?? "",
        keyResult: opt("kr") ?? "",
        expectedUplift: opt("uplift") ?? "",
        timeBox: opt("time-box") ?? "",
        stories: all("story"),
        blockers: all("blocker"),
      },
      opt("dir") ?? process.cwd(),
    );
    console.log(`Created ${path}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
