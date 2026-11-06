import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { STORY_ID, findIntentDir, read } from "../lib/project.js";
import { store } from "../lib/store.js";

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = [join(here, "../../templates"), join(here, "../templates")].find((d) => existsSync(d))!;

export interface NewPlanOptions {
  dir?: string;
  summary?: string;
  date?: string;
}

export function planVersions(intentDir: string, story: string): number[] {
  const plans = join(intentDir, "plans");
  if (!store().exists(plans)) return [];
  const re = new RegExp(`^${story}\\.v(\\d+)\\.md$`);
  return store().list(plans)
    .map((f) => re.exec(f)?.[1])
    .filter((v): v is string => !!v)
    .map(Number)
    .sort((a, b) => a - b);
}

export function newPlan(story: string, opts: NewPlanOptions = {}): string {
  if (!STORY_ID.test(story)) throw new Error(`'${story}' is not a story id (expected e.g. HT-1)`);
  const intentDir = findIntentDir(opts.dir ?? process.cwd());
  const mapPath = join(intentDir, "storymap.yaml");
  if (store().exists(mapPath)) {
    const map = parse(read(mapPath));
    const known = (map?.releases ?? []).some((r: any) => (r?.stories ?? []).includes(story));
    if (!known) throw new Error(`${story} is not in storymap.yaml`);
  }
  const versions = planVersions(intentDir, story);
  const version = (versions.at(-1) ?? 0) + 1;
  const path = join(intentDir, "plans", `${story}.v${version}.md`);
  // The template ships with nikOS, so it's always read from disk.
  const content = readFileSync(join(templateDir, "plan.md"), "utf8")
    .replace("{{story}}", story)
    .replace("{{version}}", String(version))
    .replace("{{date}}", opts.date ?? new Date().toISOString().slice(0, 10))
    .replace("{{supersedes}}", version > 1 ? `supersedes: ${version - 1}\n` : "")
    .replace("{{summary}}", opts.summary ?? "One to three plain sentences on the approach.")
    .replace("{{first_step}}", "First step, in eight words or fewer");
  // create fails if the file exists, so an earlier plan can never be overwritten.
  store().write(path, content, { create: true });
  return path;
}

export function runPlan(args: string[]): number {
  const [sub, story, ...rest] = args;
  if (sub !== "new" || !story) {
    console.error("Usage: nikos plan new <story-id> [--summary \"…\"] [--dir <path>]");
    return 1;
  }
  const opt = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  try {
    const path = newPlan(story, { summary: opt("summary"), dir: opt("dir") });
    console.log(`Created ${path}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
