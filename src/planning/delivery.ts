// Delivery status of a bet, worked out from the story map: the stories whose release (or
// own story_bets) names the bet, and their status in state.yaml. Never stored, never the outcome.
import { store } from "../lib/store.js";
import { loadStates } from "../lib/state-files.js";
import { join } from "node:path";
import { parse } from "yaml";
import { storiesFor } from "../lib/bets.js";
import { isDone } from "../lib/project.js";
import { paths } from "./model.js";

export interface Delivery {
  status: "Shipped" | "Building" | "Not started";
  done: number;
  total: number;
  stories: { id: string; status: string }[];
  releases: number[];
}

const yamlAt = (p: string) => (store().exists(p) ? parse(store().read(p)) : undefined);

export function delivery(root: string, bet: string): Delivery {
  const intent = paths(root).intent;
  const map = yamlAt(join(intent, "storymap.yaml"));
  const states = store().exists(join(intent, "storymap.yaml")) ? loadStates(intent) : {};
  const ids = map ? storiesFor(map, bet) : [];
  // A cancelled story no longer counts towards the bet.
  const stories = ids.map((id) => ({ id, status: states[id]?.status ?? "todo" })).filter((s) => s.status !== "cancelled");
  const done = stories.filter((s) => isDone(s.status)).length;
  const releases: number[] = [...new Set<number>((map?.releases ?? []).filter((r: any) => (r?.stories ?? []).some((s: string) => ids.includes(s))).map((r: any) => r.number as number))];
  const status = !stories.length ? "Not started" : done === stories.length ? "Shipped" : "Building";
  return { status, done, total: stories.length, stories, releases };
}

export const describeDelivery = (d: Delivery) =>
  d.status === "Building" ? `Building, ${d.done} of ${d.total} done` : d.status === "Shipped" ? `Shipped, ${d.total} of ${d.total} done` : "Not started";
