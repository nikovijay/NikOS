import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadStates } from "../lib/state-files.js";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { featureStoryIds, isDone, read, walk } from "../lib/project.js";
import { resolveStoryMap, mapFlag } from "../lib/maps.js";
import { parseFeature, scenariosOf } from "../lint/gherkin.js";

export interface Storyboard {
  product: { name: string; idea: string };
  users: string;
  problem: string;
  /** One beat per activity with done stories, in story map order, timed in seconds. */
  beats: { activity: string; from: number; to: number; stories: { id: string; title: string; outcomes: string[] }[] }[];
  notBuilt: { id: string; title: string }[];
  intro: [number, number];
  close: [number, number];
  total: number;
}

// Timing: a title card, then each beat holds longer for more stories, then the close.
const INTRO = 4.5, BEAT = 2.6, PER_STORY = 1.8, CLOSE = 6;

/** The constitution's front matter and its "## Section" bodies. */
function constitution(intentDir: string) {
  const path = join(intentDir, "constitution.md");
  if (!existsSync(path)) throw new Error("No intent/constitution.md: run the idea-to-blueprint playbook first");
  const text = read(path);
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const meta = (fm ? parse(fm[1]) : {}) as { name?: string; idea?: string };
  const sections: Record<string, string> = {};
  for (const m of text.slice(fm?.[0].length ?? 0).matchAll(/^## (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) sections[m[1].trim()] = m[2].trim();
  return { name: meta.name ?? "", idea: meta.idea ?? "", users: sections.Users ?? "", problem: sections.Problem ?? "" };
}

/** Draft a video storyboard from intent/: only stories marked done, one beat per activity. */
export function storyboard(dir: string, mapId?: string): Storyboard {
  const intentDir = resolveStoryMap(dir, mapId).dir;
  const c = constitution(intentDir);
  const map = parse(read(join(intentDir, "storymap.yaml"))) as { activities?: { id: string; title?: string }[] };
  const state = { stories: loadStates(intentDir) };

  const stories = walk(join(intentDir, "features"), ".feature").flatMap((path) => {
    const text = read(path);
    const id = featureStoryIds(text)[0];
    const feature = parseFeature(text);
    if (!id || !feature) return [];
    const activity = feature.tags.map((t) => t.name).find((t) => t.startsWith("@activity-"))?.slice(10) ?? "";
    // "AC1 — A new plant shows its next watering day" → "A new plant shows its next watering day"
    const outcomes = scenariosOf(feature).map((s) => s.name.replace(/^AC\d+\s*[—–-]\s*/, ""));
    return [{ id, title: feature.name, activity, outcomes, done: isDone(state.stories?.[id]?.status) }];
  });
  const byNumber = (a: { id: string }, b: { id: string }) => Number(a.id.split("-")[1]) - Number(b.id.split("-")[1]);
  const done = stories.filter((s) => s.done).sort(byNumber);
  if (!done.length) throw new Error("No story is done yet. A video shows only what's built: finish a story first (nikos next)");

  let t = INTRO;
  const beats = (map.activities ?? []).flatMap((a) => {
    const shown = done.filter((s) => s.activity === a.id).map(({ id, title, outcomes }) => ({ id, title, outcomes }));
    if (!shown.length) return [];
    const from = t;
    t += BEAT + PER_STORY * Math.min(shown.length, 4);
    return [{ activity: a.title ?? a.id, from, to: t, stories: shown }];
  });
  return {
    product: { name: c.name, idea: c.idea },
    users: c.users,
    problem: c.problem,
    beats,
    notBuilt: stories.filter((s) => !s.done).sort(byNumber).map(({ id, title }) => ({ id, title })),
    intro: [0, INTRO],
    close: [t, t + CLOSE],
    total: Math.ceil(t + CLOSE),
  };
}

const sec = (n: number) => `${Math.round(n * 10) / 10}s`;

/** The brief a person approves before anything renders. */
export function briefOf(sb: Storyboard): string {
  const rows = sb.beats.map((b, i) => `| ${sec(b.from)}–${sec(b.to)} | ${String(i + 1).padStart(2, "0")} ${b.activity} | ${b.stories.map((s) => `${s.id} ${s.title}`).join("; ")} |`);
  return [
    `# Brief: ${sb.product.name}`,
    "",
    "Drafted by `nikos video` from intent/. Approve the beats before rendering; change anything here first.",
    "",
    `- **Product:** ${sb.product.name}. ${sb.product.idea}`,
    `- **For:** ${sb.users}`,
    `- **Problem:** ${sb.problem}`,
    `- **Length:** about ${sb.total} seconds, 1080p, music only. Plays muted, so the labels carry the story.`,
    "- **In:** only stories marked done in state.yaml, each with the outcomes its passing scenarios check.",
    `- **Out:** ${sb.notBuilt.length ? `anything not built yet: ${sb.notBuilt.map((s) => `${s.id} ${s.title}`).join("; ")}.` : "nothing; every story is done."}`,
    `- **Close:** ${sb.product.name}, and its idea in one line.`,
    "",
    "## Beats",
    "",
    "One beat per activity with done stories.",
    "",
    "| Time | Label | Stories shown |",
    "| --- | --- | --- |",
    `| ${sec(sb.intro[0])}–${sec(sb.intro[1])} | Title | ${sb.product.name}: ${sb.product.idea} |`,
    ...rows,
    `| ${sec(sb.close[0])}–${sec(sb.close[1])} | Close | ${sb.product.name} |`,
    "",
  ].join("\n");
}

/** Write brief.md and storyboard.js (read by the Video pack's storyboard template) into `out`. */
export function writeVideo(dir: string, out: string, mapId?: string) {
  const sb = storyboard(dir, mapId);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "brief.md"), briefOf(sb));
  writeFileSync(join(out, "storyboard.js"), `// Drafted by nikos video from intent/. The storyboard template reads it.\nwindow.STORYBOARD = ${JSON.stringify(sb, null, 2)};\n`);
  return sb;
}

export function runVideo(args: string[]): number {
  const i = args.indexOf("--out");
  const out = resolve(i >= 0 && args[i + 1] ? args[i + 1] : "marketing/storymap-video");
  try {
    const sb = writeVideo(process.cwd(), out, mapFlag(args));
    const shown = sb.beats.reduce((n, b) => n + b.stories.length, 0);
    const r = relative(process.cwd(), out), where = !r ? "." : r.startsWith("..") ? out : r;
    console.log(`Wrote ${where}/brief.md and ${where}/storyboard.js: ${sb.beats.length} beat${sb.beats.length === 1 ? "" : "s"}, ${shown} done ${shown === 1 ? "story" : "stories"}, about ${sb.total}s`);
    if (sb.notBuilt.length) console.log(`Left out, not done yet: ${sb.notBuilt.map((s) => s.id).join(", ")}`);
    console.log("\nNext: approve the beats in brief.md, then render them with the Video pack's storyboard template.");
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
