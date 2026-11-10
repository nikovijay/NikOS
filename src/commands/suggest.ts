// `nikos suggest`: what the person could do next, as a short menu. nikOS works the options out
// from the repo so every agent offers the same ones for the same situation; the agent asks the
// question in its own way (a multiple-choice prompt where it has one) and runs what's picked.
// Labels are plain words for the person. `do` tells the agent what a pick means; it's never
// shown as a command for the person to run.
import { repoRootOf } from "../lib/maps.js";
import { store } from "../lib/store.js";
import { resolveSettings } from "../lib/settings.js";
import { join, resolve } from "node:path";
import { isDone } from "../lib/project.js";
import { mapDirs, resolveStoryMap, mapFlag } from "../lib/maps.js";
import { storyMapOf, type MapStory } from "./map.js";
import { next } from "./next.js";
import { validate, validateGroup } from "./validate.js";
import { staleCliWarning } from "../lib/cli-version.js";
import { areaFor, findArea, findPlanRepo, oldLayoutProblem } from "../plan/repo.js";
import { suggestPlan } from "../plan/suggest.js";
import { basename } from "node:path";

export interface Option {
  /** What the person sees, e.g. "Build HT-3: Reorder tasks". */
  label: string;
  /** What picking it means, for the agent: a playbook to run or a question to ask. */
  do: string;
  /** Stories it's about, when there are any. */
  stories?: string[];
}

export interface Suggestion {
  /** One line on where things stand, for the top of a reply or a session start. */
  summary: string;
  /** Two to four options, the most useful first. */
  options: Option[];
}

const MAX = 4;
const named = (s: MapStory) => `${s.id}: ${s.title}`;
const list = (ids: string[]) => (ids.length <= 3 ? ids.join(", ") : `${ids.slice(0, 2).join(", ")} and ${ids.length - 2} more`);

/** A code repo with several maps and none picked: each map's progress, and how to pick one. */
function groupSuggestion(dir: string, maps: string[]): Suggestion {
  const ids = maps.map((d) => basename(d));
  const parts = ids.map((id) => {
    try {
      const all = storyMapOf(dir, id).releases.flatMap((r) => r.stories).filter((s) => s.status !== "cancelled");
      return `${id} ${all.filter((s) => isDone(s.status)).length} of ${all.length} done`;
    } catch {
      return id;
    }
  });
  const options: Option[] = [];
  const problems = validateGroup(dir).errors.length;
  if (problems) options.unshift({ label: `Fix the ${problems} ${problems === 1 ? "problem" : "problems"} in maps/`, do: "Run nikos validate and fix each error it lists." });
  options.push({ label: "See each map's status", do: "Run nikos map status for each map and summarise what's done and approved, and what needs attention." });
  options.push({ label: `Pick a story map to work on (${list(ids)})`, do: "Ask which map, then run nikos suggest --map <id> for that map's options." });
  return { summary: `${ids.length} story maps: ${parts.join(" · ")}`, options: options.slice(0, MAX) };
}

/**
 * What to do next here. In a code repo, its story maps. In a planning repo, the area in --area (or the
 * folder you're in), else the company.
 */
export function suggest(dir: string, mapId?: string, opts: { area?: string } = {}): Suggestion {
  const old = oldLayoutProblem(dir);
  if (old) return { summary: old, options: [] };
  const maps = mapDirs(dir);
  if (!mapId && maps.length > 1) return groupSuggestion(dir, maps);
  if (!maps.length && store().isDir(join(dir, "intent"))) {
    return { summary: "this repo keeps its story map in intent/", options: [{ label: "Move the story map into maps/", do: "Move intent/ to maps/<key>/ by hand, as the release notes describe, then commit the result." }] };
  }
  if (!maps.length) {
    const repo = findPlanRepo(dir);
    if (repo) {
      const area = areaFor(repo, opts.area, dir) ?? findArea(repo, "company");
      return suggestPlan(repo, area);
    }
    return {
      summary: "nikOS isn't set up in this repo yet.",
      options: [
        { label: "Set up nikOS here", do: 'Run the start playbook: nikos start --map --name "<name>" --key <KEY>, with the name and key from the repo, then take the first story through to passing.' },
        { label: "Map what this repo already does", do: "Run the map-existing playbook: draft the story map from the existing code, then prove what's there with scenarios." },
        { label: "Link this repo to a company plan", do: "Ask which repo holds the company's plan, then run nikos join <repo path> (add --host for GitLab). It lists this repo in that plan, on a branch for review." },
      ],
    };
  }

  const mapDir = resolveStoryMap(dir, { map: mapId }).dir;
  const map = storyMapOf(dir, mapId);
  const stories = [...map.releases.flatMap((r) => r.stories), ...map.unreleased];
  const byId = new Map(stories.map((s) => [s.id, s]));
  const options: Option[] = [];
  const add = (o: Option) => options.length < MAX && options.push(o);

  const problems = validate(dir, mapId).errors.length;
  const where = `maps/${basename(mapDir)}/`;
  if (problems) add({ label: `Fix the ${problems} ${problems === 1 ? "problem" : "problems"} in ${where}`, do: `Run nikos validate${mapId ? ` --map ${mapId}` : ""} and fix each error it lists.` });

  const changed = stories.filter((s) => s.specChanged);
  if (changed.length) add({ label: `Review what changed in ${list(changed.map((s) => s.id))} since it was done`, do: "Show the feature's change since done, and ask whether to move it back to needs_rework.", stories: changed.map((s) => s.id) });

  const n = next(mapDir);
  for (const o of n.open) {
    const s = byId.get(o.id);
    add({ label: `${o.status === "needs_rework" ? "Rework" : "Finish"} ${s ? named(s) : o.id}`, do: "Run the build-a-story playbook for this story.", stories: [o.id] });
  }

  // Done stories nobody has signed off (the map shows a story with an approval that holds as
  // approved): the agent asks "Do you want to approve …?"
  const approvalsOn = resolveSettings(repoRootOf(mapDir), { map: mapDir })["approval.policy"].value !== "off";
  const unapproved = approvalsOn ? stories.filter((s) => s.status === "done" && !s.specChanged) : [];
  if (unapproved.length) {
    add({
      label: unapproved.length === 1 ? `Approve ${named(unapproved[0])}` : `Approve ${unapproved.length} done stories (${list(unapproved.map((s) => s.id))})`,
      do: "Ask the person, for each story, \"Do you want to approve <id>: <title>?\" with Approve, Not yet and Show me what was checked. Only on their Approve, run nikos approve <id> --via chat.",
      stories: unapproved.map((s) => s.id),
    });
  }

  if (n.story) {
    const s = byId.get(n.story);
    add({ label: `Build ${s ? named(s) : n.story}`, do: "Run the build-a-story playbook for this story.", stories: [n.story] });
  } else if (n.waiting.length) {
    const blocker = n.waiting[0].on[0];
    add({ label: `Unblock ${blocker} (${n.waiting[0].id} waits on it)`, do: `Run the build-a-story playbook for ${blocker}, or ask whether to change the order.`, stories: [blocker] });
  }

  // The latest release whose stories are all done: time to check it's ready to ship.
  const complete = (r: (typeof map.releases)[number]) => {
    const live = r.stories.filter((s) => s.status !== "cancelled");
    return live.length > 0 && live.every((s) => isDone(s.status) && !s.specChanged);
  };
  const ready = map.releases.filter(complete).at(-1);
  if (ready) add({ label: `Check release ${ready.number} is ready to ship`, do: `Run nikos release check ${ready.number} --run and report what it finds.` });

  add({ label: "Add a story", do: "Ask what the person wants the product to do next, then add it with nikos story add and write its scenarios." });
  add({ label: "Look at the story map", do: "Run nikos map to see it in the terminal, or nikos serve to open it in the browser, and show the person." });

  // The release being worked on: the first that isn't complete, or the last.
  const current = map.releases.find((r) => !complete(r)) ?? map.releases.at(-1);
  const live = current ? current.stories.filter((s) => s.status !== "cancelled") : [];
  const doing = stories.filter((s) => s.status === "in_progress").map((s) => s.id);
  const summary = current
    ? `Release ${current.number} · ${current.title}: ${live.filter((s) => isDone(s.status)).length} of ${live.length} done${doing.length ? ` · ${list(doing)} in progress` : ""}${
        unapproved.length ? ` · ${unapproved.length} waiting for approval` : ""
      }${problems ? ` · ${problems} ${problems === 1 ? "problem" : "problems"} in ${where}` : ""}`
    : "The story map has no releases yet.";
  return { summary, options };
}

export function runSuggest(args: string[]): number {
  const i = args.indexOf("--dir");
  const dir = resolve(i >= 0 ? args[i + 1] : process.cwd());
  const mapId = mapFlag(args);
  const area = args.indexOf("--in") >= 0 ? args[args.indexOf("--in") + 1] : undefined;
  // --brief is for a session-start hook: one line, and nothing at all outside a nikOS repo.
  if (args.includes("--brief")) {
    if (!mapDirs(dir).length && !store().isDir(join(dir, "intent")) && !findPlanRepo(dir)) return 0;
    try {
      const s = suggest(dir, mapId, { area });
      console.log(`nikOS: ${s.summary}. Suggested next: ${s.options.map((o) => o.label).join(" · ")}.`);
      const stale = staleCliWarning();
      if (stale) console.log(`nikOS: ${stale}`);
    } catch {
      // A hook must never break the session.
    }
    return 0;
  }
  try {
    const s = suggest(dir, mapId, { area });
    if (args.includes("--json")) {
      console.log(JSON.stringify(s, null, 2));
      return 0;
    }
    console.log(s.summary);
    s.options.forEach((o, n) => console.log(`  ${n + 1}. ${o.label}`));
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
