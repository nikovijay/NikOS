// Which team has which part of a group's story map: maps/<id>/assignments.yaml. A list of
// { team, repo, releases | activities | stories }, or neither for the whole map. A story belongs
// to at most one team. This file and the map's own storymap.yaml and features decide what each
// team gets, and nothing here writes to a team's repo.
import { basename, dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { store } from "./store.js";
import { schemaProblems } from "./schema.js";
import { featureStoryIds, read, walk } from "./project.js";

export interface Assignment {
  team: string;
  /** The team's repo path, or "." when the group repo is its own team. */
  repo: string;
  releases?: number[];
  activities?: string[];
  stories?: string[];
}

export const ASSIGNMENTS = "assignments.yaml";

/** A map's contents, read once: its storymap, and each feature with its story id and activity. */
export interface MapData {
  dir: string;
  storymap: any;
  activities: string[];
  releases: Map<number, string[]>;
  features: { id: string; activity: string; path: string; text: string }[];
}

/** The map in a folder: storymap.yaml, and every feature in features/, with the activity each belongs to. */
export function loadMapData(dir: string): MapData {
  const storymap = parse(read(join(dir, "storymap.yaml"))) ?? {};
  const releases = new Map<number, string[]>();
  for (const r of storymap.releases ?? []) if (typeof r?.number === "number") releases.set(r.number, (r.stories ?? []).map(String));
  const features = walk(join(dir, "features"), ".feature").flatMap((path) => {
    const text = read(path);
    const id = featureStoryIds(text)[0];
    if (!id) return [];
    // The @activity tag names the activity; a feature without one belongs to its folder's.
    const activity = /@activity-([a-z0-9-]+)/.exec(text.split(/^\s*Feature:/m)[0])?.[1] ?? basename(dirname(path));
    return [{ id, activity, path, text }];
  });
  return {
    dir,
    storymap,
    activities: (storymap.activities ?? []).map((a: any) => String(a?.id)),
    releases,
    features,
  };
}

/** Every story id in the map, in release order (then any feature no release names, in file order). */
export function mapStoryIds(map: MapData): string[] {
  const have = new Set(map.features.map((f) => f.id));
  const ordered = [...map.releases.keys()].sort((a, b) => a - b).flatMap((n) => map.releases.get(n)!).filter((id) => have.has(id));
  const placed = new Set(ordered);
  return [...new Set([...ordered, ...map.features.map((f) => f.id).filter((id) => !placed.has(id))])];
}

/** The assignments in a map folder, checked against the schema; [] when there's no file. */
export function readAssignments(mapDir: string): Assignment[] {
  const path = join(mapDir, ASSIGNMENTS);
  if (!store().exists(path)) return [];
  const data = parse(read(path)) ?? [];
  const problems = schemaProblems("assignments.schema.json", data);
  if (problems.length) throw new Error(`${ASSIGNMENTS}: ${problems[0]}`);
  return data as Assignment[];
}

/**
 * Write the assignments. The file is rewritten from the list, so comments on its entries are not
 * kept; its header is. An empty list is written as [] so the map stays valid.
 */
export function writeAssignments(mapDir: string, list: Assignment[]): void {
  const header = "# Written by nikos assign: which team has which part of this map.\n";
  store().write(join(mapDir, ASSIGNMENTS), `${header}${list.length ? stringify(list) : "[]\n"}`);
}

/**
 * The story ids one assignment gives: its releases' stories, its activities' stories, its listed
 * stories, or every story in the map when it names neither.
 */
export function storiesOf(map: MapData, a: Assignment): string[] {
  if (a.stories) return [...a.stories];
  if (a.releases) return a.releases.flatMap((n) => map.releases.get(n) ?? []);
  if (a.activities) return map.features.filter((f) => a.activities!.includes(f.activity)).map((f) => f.id);
  return mapStoryIds(map);
}

/** The assignment that gives a story to a team, if any. */
export function holderOf(list: Assignment[], map: MapData, id: string): Assignment | undefined {
  return list.find((a) => storiesOf(map, a).includes(id));
}

/**
 * Problems with a map's assignments: a selector that names nothing in the map, and a story that
 * two teams both hold. Errors only; the unassigned stories are the caller's warning.
 */
export function checkAssignments(map: MapData, list: Assignment[], label: string): { errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(mapStoryIds(map));
  for (const a of list) {
    for (const act of a.activities ?? []) if (!map.activities.includes(act)) errors.push(`activity "${act}" is not in ${label}/storymap.yaml`);
    for (const n of a.releases ?? []) if (!map.releases.has(n)) errors.push(`release ${n} is not in ${label}/storymap.yaml`);
    for (const id of a.stories ?? []) if (!ids.has(id)) errors.push(`story ${id} is not in ${label}/features`);
  }
  const owner = new Map<string, Assignment>();
  for (const a of list) {
    for (const id of storiesOf(map, a)) {
      const first = owner.get(id);
      if (first && first !== a) errors.push(`${id} is assigned to both ${first.team} and ${a.team}`);
      else owner.set(id, a);
    }
  }
  return { errors };
}
