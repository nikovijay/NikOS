import { store } from "../lib/store.js";
import { join } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import { findIntentDir, read } from "../lib/project.js";
import { slugify } from "./init.js";
import { validate, type ValidationResult } from "./validate.js";

const yamlOpts = { lineWidth: 0, flowCollectionPadding: false };

/** Add a step to an activity in storymap.yaml. Its id is the title's slug unless given. */
export function newStep(input: { title: string; activity: string; id?: string }, dir: string): { id: string; validation: ValidationResult } {
  const title = input.title?.trim();
  if (!title) throw new Error("A step needs a title");
  const intentDir = findIntentDir(dir);
  const mapPath = join(intentDir, "storymap.yaml");
  // A Document keeps comments and the order of everything we don't touch.
  const map = parseDocument(read(mapPath));
  const activities = map.get("activities", true);
  const list = isSeq(activities) ? activities.items.filter(isMap) : [];
  const activity = list.find((a) => a.get("id") === input.activity);
  if (!activity) throw new Error(`'${input.activity}' is not an activity in storymap.yaml. Activities: ${list.map((a) => a.get("id")).join(", ") || "none"}`);
  const id = input.id ?? slugify(title);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`'${id}' is not a step id: use lowercase words joined by hyphens`);
  const taken = list.flatMap((a) => {
    const steps = a.get("steps", true);
    return isSeq(steps) ? steps.items.filter(isMap).map((s) => String(s.get("id"))) : [];
  });
  if (taken.includes(id)) throw new Error(`There is already a step '${id}'; give it a different --id`);
  const steps = activity.get("steps", true);
  if (isSeq(steps)) steps.add(map.createNode({ id, title }));
  else activity.set("steps", map.createNode([{ id, title }]));
  store().write(mapPath, map.toString(yamlOpts));
  return { id, validation: validate(intentDir) };
}

/** Add an activity to the story map, e.g. an area of an existing product or an imported epic. Returns its id; an existing one is left as it is. */
export function newActivity(input: { title: string; id?: string }, dir: string): string {
  const title = input.title?.trim();
  if (!title) throw new Error("An activity needs a title");
  const intentDir = findIntentDir(dir);
  const mapPath = join(intentDir, "storymap.yaml");
  const map = parseDocument(read(mapPath));
  const id = input.id ?? slugify(title);
  const activities = map.get("activities", true);
  if (!isSeq(activities)) throw new Error("storymap.yaml has no activities list");
  if (activities.items.some((a) => isMap(a) && a.get("id") === id)) return id;
  activities.add(map.createNode({ id, title }));
  store().write(mapPath, map.toString(yamlOpts));
  return id;
}

export function runActivity(args: string[]): number {
  const [sub, title, ...rest] = args;
  const i = rest.indexOf("--id");
  const d = rest.indexOf("--dir");
  if (sub !== "add" || !title || title.startsWith("--")) {
    console.error('Usage: nikos activity add "<title>" [--id <activity-id>]');
    return 1;
  }
  try {
    const id = newActivity({ title, id: i >= 0 ? rest[i + 1] : undefined }, d >= 0 ? rest[d + 1] : process.cwd());
    console.log(`Activity ${id}: its stories go in intent/features/${id}/`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

export function runStep(args: string[]): number {
  const [sub, title, ...rest] = args;
  const opt = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (sub !== "add" || !title || title.startsWith("--") || !opt("activity")) {
    console.error('Usage: nikos step add "<title>" --activity <id> [--id <step-id>]');
    return 1;
  }
  try {
    const r = newStep({ title, activity: opt("activity")!, id: opt("id") }, opt("dir") ?? process.cwd());
    console.log(`Added step ${r.id} to activity ${opt("activity")}`);
    console.log(`\nTag a story's feature with @step-${r.id}, or add one with nikos story add "<title>" --activity ${opt("activity")} --step ${r.id}.`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
