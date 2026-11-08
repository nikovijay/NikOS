import { join } from "node:path";
import { loadStates } from "../lib/state-files.js";
import { parse } from "yaml";
import { store } from "../lib/store.js";
import { featureStoryIds, featureTags, isDone, read, walk } from "../lib/project.js";
import { heldIds, homeOf, storyMapFor, mapFlag } from "../lib/maps.js";

export interface NextResult {
  /** The story to build next, or undefined when nothing is left to do. */
  story?: string;
  /** Stories already started; finish these before starting something new. */
  open: { id: string; status: string }[];
  /** Todo stories passed over because a story they depend on isn't done yet. */
  waiting: { id: string; on: string[] }[];
  /** The story returned depends on stories another team holds: this team can't see them, so next doesn't wait on them. */
  unchecked?: string[];
}

/** Each story's @depends-<id> tags, from its feature file. */
export function dependencies(intentDir: string): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  for (const file of walk(join(intentDir, "features"), ".feature")) {
    const text = read(file);
    const id = featureStoryIds(text)[0];
    if (id) deps.set(id, featureTags(text, "depends"));
  }
  return deps;
}

/** The first todo story in run.queue, then in story map order, whose dependencies are all done. */
export function next(dir: string, mapId?: string): NextResult {
  const ref = storyMapFor(dir, { map: mapId });
  const intentDir = ref.dir;
  const map = parse(read(join(intentDir, "storymap.yaml")));
  const state = store().exists(join(intentDir, "state.yaml")) ? parse(read(join(intentDir, "state.yaml"))) : undefined;
  const stories: Record<string, { status?: string }> = loadStates(homeOf(ref));
  const mapOrder: string[] = (map?.releases ?? [])
    .slice()
    .sort((a: any, b: any) => a.number - b.number)
    .flatMap((r: any) => r.stories ?? []);
  const order = [...new Set([...(state?.run?.queue ?? []), ...mapOrder])];
  const open = order.filter((id) => ["in_progress", "needs_rework"].includes(stories[id]?.status ?? "")).map((id) => ({ id, status: stories[id].status! }));
  const deps = dependencies(intentDir);
  const waiting: NextResult["waiting"] = [];
  // In a team repo, a dependency outside the copy is held by another team: it has no status here,
  // so waiting on it would wait forever. It's reported instead.
  const held = ref.team ? heldIds(ref) : undefined;
  for (const id of order) {
    if ((stories[id]?.status ?? "todo") !== "todo") continue;
    const all = deps.get(id) ?? [];
    const foreign = held ? all.filter((d) => !held.has(d)) : [];
    const on = all.filter((d) => !foreign.includes(d) && !isDone(stories[d]?.status));
    if (!on.length) return { story: id, open, waiting, ...(foreign.length ? { unchecked: foreign } : {}) };
    waiting.push({ id, on });
  }
  return { open, waiting };
}

export function runNext(args: string[]): number {
  const i = args.indexOf("--dir");
  try {
    const r = next(i >= 0 ? args[i + 1] : process.cwd(), mapFlag(args));
    for (const o of r.open) console.log(`! ${o.id} is ${o.status}; finish it first`);
    if (!r.story) {
      for (const w of r.waiting) console.log(`! ${w.id} is waiting on ${w.on.join(", ")}`);
      console.log(r.waiting.length ? "Nothing is ready: every todo story waits on another." : "Nothing left to do: every story is started or done.");
      return 0;
    }
    for (const d of r.unchecked ?? []) console.log(`! ${r.story} depends on ${d}, which another team holds: nikos next doesn't wait on it here`);
    console.log(r.story);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
