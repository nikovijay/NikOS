// A story map's contents, read from its folder: the storymap, and each feature with its story id
// and activity. Every command that counts or checks a map's stories reads them through here.
import { basename, dirname, join } from "node:path";
import { parse } from "yaml";
import { featureStoryIds, read, walk } from "./project.js";

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
