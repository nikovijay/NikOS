import { store } from "../lib/store.js";
import { join } from "node:path";
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq, type Document } from "yaml";
import { featureStoryIds, isDone, read, setFeatureTag, walk } from "../lib/project.js";
import { authoringMap, resolveStoryMap } from "../lib/maps.js";
import { storyMapOf } from "./map.js";
import { resolveSettings } from "../lib/settings.js";
import { loadApprovals } from "../lib/approvals.js";
import { failingScenarios } from "./state.js";
import { verify } from "./verify.js";
import { validate, type ValidationResult } from "./validate.js";

const yamlOpts = { lineWidth: 0, flowCollectionPadding: false };

interface Opened {
  intentDir: string;
  mapPath: string;
  map: Document;
  releases: YAMLSeq<YAMLMap>;
}

function open(dir: string, mapId?: string): Opened {
  const intentDir = authoringMap(dir, mapId).dir;
  const mapPath = join(intentDir, "storymap.yaml");
  // A Document keeps comments and the order of everything we don't touch.
  const map = parseDocument(read(mapPath));
  const releases = map.get("releases", true);
  if (!isSeq(releases)) throw new Error("storymap.yaml has no releases list");
  return { intentDir, mapPath, map, releases: releases as YAMLSeq<YAMLMap> };
}

const numberOf = (r: YAMLMap) => Number(r.get("number"));
const storiesOf = (r: YAMLMap): string[] => {
  const s = r.get("stories", true);
  return isSeq(s) ? s.items.map((i: any) => String(i?.value ?? i)) : [];
};

function find(o: Opened, n: number): YAMLMap {
  const r = o.releases.items.find((i) => isMap(i) && numberOf(i) === n);
  if (!r) throw new Error(`There is no release ${n}. Releases: ${o.releases.items.map(numberOf).join(", ") || "none"}`);
  return r;
}

/** Rewrite the @release-<n> tag on each moved story's feature file. */
function retag(intentDir: string, moved: Map<string, number>) {
  if (!moved.size) return;
  for (const file of walk(join(intentDir, "features"), ".feature")) {
    const text = read(file);
    const id = featureStoryIds(text)[0];
    if (id && moved.has(id)) store().write(file, setFeatureTag(text, "release", String(moved.get(id)), id));
  }
}

/** Number the releases 1, 2, 3… in list order, retagging the stories of any that changed. */
function renumber(o: Opened) {
  const moved = new Map<string, number>();
  o.releases.items.forEach((item, i) => {
    if (numberOf(item) === i + 1) return;
    item.set("number", i + 1);
    for (const id of storiesOf(item)) moved.set(id, i + 1);
  });
  retag(o.intentDir, moved);
}

function save(o: Opened): ValidationResult {
  store().write(o.mapPath, o.map.toString(yamlOpts));
  return validate(o.intentDir);
}

const cleanTitle = (title: string | undefined) => {
  const t = title?.trim();
  if (!t) throw new Error("A release needs a title");
  return t;
};

/** Refuse a title another release already has (ignoring case), so two releases can't share a name. */
function uniqueTitle(o: Opened, title: string, except?: YAMLMap) {
  const taken = o.releases.items.find((r) => r !== except && String(r.get("title")).trim().toLowerCase() === title.toLowerCase());
  if (taken) throw new Error(`Release ${numberOf(taken)} is already called '${String(taken.get("title"))}'`);
  return title;
}

/** Add the next numbered release, with no stories yet. */
export function addRelease(input: { map?: string; title: string; goal?: string }, dir: string) {
  const o = open(dir, input.map);
  const number = Math.max(0, ...o.releases.items.map(numberOf)) + 1;
  const goal = input.goal?.trim();
  o.releases.add(o.map.createNode({ number, title: uniqueTitle(o, cleanTitle(input.title)), ...(goal ? { goal } : {}), stories: [] }));
  const added = o.releases.items[o.releases.items.length - 1];
  (added.get("stories", true) as unknown as YAMLSeq).flow = true;
  return { number, validation: save(o) };
}

/** Change a release's title and/or goal. An empty goal removes it. */
export function renameRelease(input: { map?: string; number: number; title?: string; goal?: string }, dir: string) {
  if (input.title === undefined && input.goal === undefined) throw new Error("Give a new title, a --goal, or both");
  const o = open(dir, input.map);
  const r = find(o, input.number);
  if (input.title !== undefined) r.set("title", uniqueTitle(o, cleanTitle(input.title), r));
  if (input.goal !== undefined) {
    const goal = input.goal.trim();
    if (!goal) r.delete("goal");
    else if (r.has("goal")) r.set("goal", goal);
    else {
      // Keep goal next to the title rather than after the stories.
      const at = r.items.findIndex((p: any) => p.key?.value === "title") + 1;
      r.items.splice(at, 0, o.map.createPair("goal", goal) as any);
    }
  }
  return { number: input.number, validation: save(o) };
}

/** Move a story to another release (to the end of its build order), keeping its feature tag in step. */
export function moveStory(input: { map?: string; id: string; to: number }, dir: string) {
  const o = open(dir, input.map);
  const target = find(o, input.to);
  const from = o.releases.items.find((r) => storiesOf(r).includes(input.id));
  if (!from) throw new Error(`${input.id} is not in any release in storymap.yaml`);
  const fromNumber = numberOf(from);
  if (fromNumber === input.to) throw new Error(`${input.id} is already in release ${input.to}`);
  const seq = from.get("stories", true) as unknown as YAMLSeq;
  seq.items.splice(storiesOf(from).indexOf(input.id), 1);
  const dest = target.get("stories", true);
  if (isSeq(dest)) dest.add(input.id);
  else target.set("stories", o.map.createNode([input.id], { flow: true }));
  retag(o.intentDir, new Map([[input.id, input.to]]));
  return { id: input.id, from: fromNumber, to: input.to, validation: save(o) };
}

/** Remove an empty release and renumber the ones after it, retagging their stories. */
export function removeRelease(input: { map?: string; number: number }, dir: string) {
  const o = open(dir, input.map);
  const r = find(o, input.number);
  const stories = storiesOf(r);
  if (stories.length) throw new Error(`Release ${input.number} still has ${stories.join(", ")}. Move its stories out first with nikos release move`);
  const bets = r.get("bets", true);
  if (isSeq(bets) && bets.items.length) throw new Error(`Release ${input.number} delivers bets (${bets.items.map((b: any) => String(b?.value ?? b)).join(", ")}). Move them to another release first`);
  const title = String(r.get("title"));
  const items = o.releases.items;
  items.splice(items.indexOf(r), 1);
  renumber(o);
  return { number: input.number, title, validation: save(o) };
}

/** Move a release to a new position and renumber them all from 1, retagging every story that moved. */
export function reorderRelease(input: { map?: string; number: number; to: number }, dir: string) {
  const o = open(dir, input.map);
  const r = find(o, input.number);
  const count = o.releases.items.length;
  if (!Number.isInteger(input.to) || input.to < 1 || input.to > count) throw new Error(`Position must be from 1 to ${count}`);
  const items = o.releases.items;
  items.splice(items.indexOf(r), 1);
  items.splice(input.to - 1, 0, r);
  renumber(o);
  return { order: items.map((i) => ({ number: numberOf(i), title: String(i.get("title")) })), validation: save(o) };
}

export interface ReleaseCheck {
  number: number;
  title: string;
  ready: boolean;
  /** "4 of 6 done · 2 approved · 1 cancelled" */
  summary: string;
  /** What stands between the release and shipping, one line per problem. */
  gaps: string[];
}

const STATUS_WORD: Record<string, string> = { todo: "to do", in_progress: "in progress", needs_rework: "in rework" };

/**
 * Is a release ready to ship? Every story that isn't cancelled must be done (or approved), not
 * blocked, have scenarios, and still match the feature it was done against; its dependencies
 * outside the release must be done too. With run, each done story's scenarios run again.
 */
export function checkRelease(input: { map?: string; number: number; run?: boolean }, dir: string): ReleaseCheck {
  const map = storyMapOf(dir, input.map);
  const release = map.releases.find((r) => r.number === input.number);
  if (!release) throw new Error(`There is no release ${input.number}. Releases: ${map.releases.map((r) => r.number).join(", ") || "none"}`);
  const inRelease = new Set(release.stories.map((s) => s.id));
  // approval.policy: required-for-release makes a done story without a sign-off a gap.
  const ref = resolveStoryMap(dir, input.map);
  const needApproval = resolveSettings(ref.root)["approval.policy"].value === "required-for-release";
  const live = release.stories.filter((s) => s.status !== "cancelled");
  // A done story with an approval on file that no longer holds: say so, as validate does.
  const signedOff = loadApprovals(ref.dir);
  const lapsed = (s: (typeof live)[number]) => s.status === "done" && !!signedOff[s.id];
  const gaps: string[] = [];
  for (const s of live) {
    if (!isDone(s.status)) gaps.push(`${s.id} is ${STATUS_WORD[s.status] ?? s.status}`);
    if (s.blocked) gaps.push(`${s.id} is blocked`);
    if (!s.criteria.length) gaps.push(`${s.id} has no scenarios`);
    if (s.specChanged) gaps.push(`${s.id}'s feature changed after it was ${s.status}${lapsed(s) ? `, so ${signedOff[s.id].by}'s approval no longer holds` : ""}`);
    else if (needApproval && s.status === "done") {
      gaps.push(lapsed(s) ? `${s.id} isn't approved: it went through done again since ${signedOff[s.id].by} approved it` : `${s.id} isn't approved`);
    }
    const outside = s.waitingOn.filter((d) => !inRelease.has(d));
    if (outside.length) gaps.push(`${s.id} depends on ${outside.join(", ")}, which ${outside.length === 1 ? "isn't" : "aren't"} done`);
  }
  if (input.run) {
    for (const s of live.filter((x) => isDone(x.status) && x.criteria.length)) {
      let run;
      try {
        run = verify(ref.root, s.id, { map: ref.id });
      } catch (err) {
        gaps.push(`${s.id}'s scenarios couldn't run: ${(err as Error).message}`);
        continue;
      }
      if (run.status !== 0) {
        const failing = failingScenarios(run.output);
        gaps.push(`${s.id}'s scenarios fail${failing.length ? `: ${failing.join(", ")}` : ""}`);
      }
    }
  }
  const n = (f: (s: (typeof live)[number]) => boolean) => live.filter(f).length;
  const cancelled = release.stories.length - live.length;
  const summary = [
    `${n((s) => isDone(s.status))} of ${live.length} done`,
    ...(n((s) => s.status === "approved") ? [`${n((s) => s.status === "approved")} approved`] : []),
    ...(cancelled ? [`${cancelled} cancelled`] : []),
  ].join(" · ");
  return { number: release.number, title: release.title, ready: live.length > 0 && gaps.length === 0, summary, gaps: live.length ? gaps : ["it has no stories"] };
}

const USAGE = `Usage:
  nikos release add "<title>" [--goal "<goal>"]
  nikos release rename <n> ["<title>"] [--goal "<goal>"]   (--goal "" removes it)
  nikos release move <story-id> <n>
  nikos release reorder <n> <position>
  nikos release remove <n>   (only an empty release)
  nikos release check <n> [--run]   (--run reruns each done story's scenarios)`;

function report(v: ValidationResult) {
  if (v.errors.length) console.log(`\n! intent/ now has ${v.errors.length} ${v.errors.length === 1 ? "problem" : "problems"}; run nikos validate to see them.`);
}

export function runRelease(args: string[]): number {
  const [sub, ...rest] = args;
  const opt = (n: string) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
  const dir = opt("dir") ?? process.cwd();
  try {
    if (sub === "add" && positional[0]) {
      const r = addRelease({ title: positional[0], goal: opt("goal"), map: opt("map") }, dir);
      console.log(`Added release ${r.number}: ${positional[0].trim()}`);
      report(r.validation);
    } else if (sub === "rename" && positional[0]) {
      const r = renameRelease({ number: Number(positional[0]), title: positional[1], goal: opt("goal"), map: opt("map") }, dir);
      console.log(`Updated release ${r.number}`);
      report(r.validation);
    } else if (sub === "move" && positional[0] && positional[1]) {
      const r = moveStory({ id: positional[0], to: Number(positional[1]), map: opt("map") }, dir);
      console.log(`Moved ${r.id} from release ${r.from} to release ${r.to}`);
      report(r.validation);
    } else if (sub === "reorder" && positional[0] && positional[1]) {
      const r = reorderRelease({ number: Number(positional[0]), to: Number(positional[1]), map: opt("map") }, dir);
      console.log(`Releases are now:\n${r.order.map((x) => `  ${x.number}. ${x.title}`).join("\n")}`);
      report(r.validation);
    } else if (sub === "check" && positional[0]) {
      const r = checkRelease({ number: Number(positional[0]), run: rest.includes("--run"), map: opt("map") }, dir);
      console.log(`Release ${r.number} · ${r.title}: ${r.ready ? "ready" : "not ready"} — ${r.summary}`);
      for (const g of r.gaps) console.log(`  ✗ ${g}`);
      return r.ready ? 0 : 1;
    } else if (sub === "remove" && positional[0]) {
      const r = removeRelease({ number: Number(positional[0]), map: opt("map") }, dir);
      console.log(`Removed release ${r.number}: ${r.title}`);
      report(r.validation);
    } else {
      console.error(USAGE);
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
