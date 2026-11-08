// Delivery status of a bet, worked out from the story map: the stories whose release (or
// own story_bets) names the bet, and their status in state.yaml. Never stored, never the outcome.
import { store } from "../lib/store.js";
import { loadStates } from "../lib/state-files.js";
import { join } from "node:path";
import { parse } from "yaml";
import { storiesFor } from "../lib/bets.js";
import { isDone } from "../lib/project.js";
import { storyMapsOf } from "../lib/maps.js";

export interface Delivery {
  status: "Shipped" | "Building" | "Not started";
  done: number;
  total: number;
  stories: { id: string; status: string }[];
  releases: number[];
  /** The maps that contributed stories: each map's id, or intent for the repo's own map. */
  maps: string[];
}

const yamlAt = (p: string) => (store().exists(p) ? parse(store().read(p)) : undefined);

/** A bet's delivery across every story map in the repo that specs it. */
export function delivery(root: string, bet: string): Delivery {
  const stories: { id: string; status: string }[] = [];
  const releases = new Set<number>();
  const maps: string[] = [];
  for (const ref of storyMapsOf(root)) {
    const map = yamlAt(join(ref.dir, "storymap.yaml"));
    const ids = map ? storiesFor(map, bet) : [];
    if (!ids.length) continue;
    maps.push(ref.id ?? "intent");
    const states = loadStates(ref.dir);
    // A cancelled story no longer counts towards the bet.
    for (const id of ids) {
      const status = states[id]?.status ?? "todo";
      if (status !== "cancelled") stories.push({ id, status });
    }
    for (const r of map?.releases ?? []) if ((r?.stories ?? []).some((s: string) => ids.includes(s))) releases.add(r.number as number);
  }
  const done = stories.filter((s) => isDone(s.status)).length;
  const status = !stories.length ? "Not started" : done === stories.length ? "Shipped" : "Building";
  return { status, done, total: stories.length, stories, releases: [...releases], maps };
}

export const describeDelivery = (d: Delivery) =>
  d.status === "Building" ? `Building, ${d.done} of ${d.total} done` : d.status === "Shipped" ? `Shipped, ${d.total} of ${d.total} done` : "Not started";
