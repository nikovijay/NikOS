// Delivery status of a bet, worked out from the story map: the stories whose release (or
// own story_bets) names the bet, and their status in state.yaml. Never stored, never the outcome.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { storiesFor } from "../lib/bets.js";
import { paths } from "./model.js";

export interface Delivery {
  status: "Shipped" | "Building" | "Not started";
  done: number;
  total: number;
  stories: { id: string; status: string }[];
  releases: number[];
}

const yamlAt = (p: string) => (existsSync(p) ? parse(readFileSync(p, "utf8")) : undefined);

export function delivery(root: string, bet: string): Delivery {
  const intent = paths(root).intent;
  const map = yamlAt(join(intent, "storymap.yaml"));
  const state = yamlAt(join(intent, "state.yaml"));
  const ids = map ? storiesFor(map, bet) : [];
  const stories = ids.map((id) => ({ id, status: state?.stories?.[id]?.status ?? "todo" }));
  const done = stories.filter((s) => s.status === "done").length;
  const releases: number[] = [...new Set<number>((map?.releases ?? []).filter((r: any) => (r?.stories ?? []).some((s: string) => ids.includes(s))).map((r: any) => r.number as number))];
  const status = !stories.length ? "Not started" : done === stories.length ? "Shipped" : "Building";
  return { status, done, total: stories.length, stories, releases };
}

export const describeDelivery = (d: Delivery) =>
  d.status === "Building" ? `Building, ${d.done} of ${d.total} done` : d.status === "Shipped" ? `Shipped, ${d.total} of ${d.total} done` : "Not started";
