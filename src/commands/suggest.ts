// `nikos suggest`: what the person could do next, as a short menu. nikOS works the options out
// from the repo so every agent offers the same ones for the same situation; the agent asks the
// question in its own way (a multiple-choice prompt where it has one) and runs what's picked.
// Labels are plain words for the person. `do` tells the agent what a pick means; it's never
// shown as a command for the person to run.
import { store } from "../lib/store.js";
import { join, resolve } from "node:path";
import { findIntentDir, isDone } from "../lib/project.js";
import { storyMapOf, type MapStory } from "./map.js";
import { next } from "./next.js";
import { validate } from "./validate.js";

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

export function suggest(dir: string): Suggestion {
  const intentDir = findIntentDir(dir);
  if (!store().exists(join(intentDir, "storymap.yaml"))) {
    return {
      summary: "nikOS isn't set up in this repo yet.",
      options: [
        { label: "Set up nikOS here", do: "Run the idea-to-blueprint playbook for a new product, or nikos init with sensible defaults for an existing one." },
        { label: "Map what this repo already does", do: "Draft the story map from the existing code: one activity per area, a story per feature that already exists." },
        { label: "Join our company plan", do: "Run the upstream playbook to link this repo to the company or department plan above it." },
      ],
    };
  }

  const map = storyMapOf(dir);
  const stories = [...map.releases.flatMap((r) => r.stories), ...map.unreleased];
  const byId = new Map(stories.map((s) => [s.id, s]));
  const options: Option[] = [];
  const add = (o: Option) => options.length < MAX && options.push(o);

  const problems = validate(dir).errors.length;
  if (problems) add({ label: `Fix the ${problems} ${problems === 1 ? "problem" : "problems"} in intent/`, do: "Run nikos validate and fix each error it lists." });

  const changed = stories.filter((s) => s.specChanged);
  if (changed.length) add({ label: `Review what changed in ${list(changed.map((s) => s.id))} since it was done`, do: "Show the feature's change since done, and ask whether to move it back to needs_rework.", stories: changed.map((s) => s.id) });

  const n = next(intentDir);
  for (const o of n.open) {
    const s = byId.get(o.id);
    add({ label: `${o.status === "needs_rework" ? "Rework" : "Finish"} ${s ? named(s) : o.id}`, do: "Run the build-a-story playbook for this story.", stories: [o.id] });
  }

  // Done stories nobody has signed off (the map shows a story with an approval that holds as
  // approved): the agent asks "Do you want to approve …?"
  const unapproved = stories.filter((s) => s.status === "done" && !s.specChanged);
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
  add({ label: "Look at the story map", do: "Run nikos map, or open the planning dashboard's map if it's running, and show the person." });

  // The release being worked on: the first that isn't complete, or the last.
  const current = map.releases.find((r) => !complete(r)) ?? map.releases.at(-1);
  const live = current ? current.stories.filter((s) => s.status !== "cancelled") : [];
  const doing = stories.filter((s) => s.status === "in_progress").map((s) => s.id);
  const summary = current
    ? `Release ${current.number} · ${current.title}: ${live.filter((s) => isDone(s.status)).length} of ${live.length} done${doing.length ? ` · ${list(doing)} in progress` : ""}${
        unapproved.length ? ` · ${unapproved.length} waiting for approval` : ""
      }${problems ? ` · ${problems} ${problems === 1 ? "problem" : "problems"} in intent/` : ""}`
    : "The story map has no releases yet.";
  return { summary, options };
}

export function runSuggest(args: string[]): number {
  const i = args.indexOf("--dir");
  const dir = resolve(i >= 0 ? args[i + 1] : process.cwd());
  // --brief is for a session-start hook: one line, and nothing at all outside a nikOS repo.
  if (args.includes("--brief")) {
    if (!store().exists(join(findIntentDir(dir), "storymap.yaml"))) return 0;
    try {
      const s = suggest(dir);
      console.log(`nikOS: ${s.summary}. Suggested next: ${s.options.map((o) => o.label).join(" · ")}.`);
    } catch {
      // A hook must never break the session.
    }
    return 0;
  }
  try {
    const s = suggest(dir);
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
