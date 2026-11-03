import { join } from "node:path";
import { parse } from "yaml";
import { findIntentDir, read } from "../lib/project.js";

export interface NextResult {
  /** The story to build next, or undefined when nothing is left to do. */
  story?: string;
  /** Stories already started; finish these before starting something new. */
  open: { id: string; status: string }[];
}

/** The first todo story in run.queue, then in story map order. */
export function next(dir: string): NextResult {
  const intentDir = findIntentDir(dir);
  const map = parse(read(join(intentDir, "storymap.yaml")));
  const state = parse(read(join(intentDir, "state.yaml")));
  const stories: Record<string, { status?: string }> = state?.stories ?? {};
  const mapOrder: string[] = (map?.releases ?? [])
    .slice()
    .sort((a: any, b: any) => a.number - b.number)
    .flatMap((r: any) => r.stories ?? []);
  const order = [...new Set([...(state?.run?.queue ?? []), ...mapOrder])];
  const open = order.filter((id) => ["in_progress", "needs_rework"].includes(stories[id]?.status ?? "")).map((id) => ({ id, status: stories[id].status! }));
  return { story: order.find((id) => (stories[id]?.status ?? "todo") === "todo"), open };
}

export function runNext(args: string[]): number {
  const i = args.indexOf("--dir");
  try {
    const r = next(i >= 0 ? args[i + 1] : process.cwd());
    for (const o of r.open) console.log(`! ${o.id} is ${o.status}; finish it first`);
    if (!r.story) {
      console.log("Nothing left to do: every story is started or done.");
      return 0;
    }
    console.log(r.story);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
