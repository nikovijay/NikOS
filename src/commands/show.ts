import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { STORY_ID, findIntentDir, read, rel, walk } from "../lib/project.js";
import { parseFeature, scenariosOf } from "../lint/gherkin.js";
import { featureFor } from "./clear.js";
import { planVersions } from "./plan.js";
import { parseBet } from "./bet.js";
import { decisionEntries } from "./decisions.js";

const yamlFile = (path: string) => (existsSync(path) ? parse(read(path)) : undefined);

/** Everything the intent/ folder says about one story, in plain text. */
export function show(story: string, dir: string): string {
  if (!STORY_ID.test(story)) throw new Error(`'${story}' is not a story id (expected e.g. HT-1)`);
  const intentDir = findIntentDir(dir);
  const file = featureFor(story, dir);
  if (!file) throw new Error(`No feature file is tagged @${story}`);
  const feature = parseFeature(read(file));
  if (!feature) throw new Error(`${rel(intentDir, file)} has no Feature`);

  const tags = feature.tags.map((t) => t.name.slice(1));
  const priority = tags.find((t) => ["must", "should", "could", "wont"].includes(t));
  const effort = tags.find((t) => t.startsWith("effort-"))?.slice(7);
  const map = yamlFile(join(intentDir, "storymap.yaml"));
  const release = (map?.releases ?? []).find((r: any) => (r?.stories ?? []).includes(story));
  const entry = yamlFile(join(intentDir, "state.yaml"))?.stories?.[story];

  const out = [`${story} — ${feature.name}`];
  if (entry) {
    const extra = [entry.claimed_by && `claimed by ${entry.claimed_by}`, entry.updated && `updated ${entry.updated}`].filter(Boolean);
    out.push(`Status: ${entry.status}${extra.length ? ` (${extra.join(", ")})` : ""}`);
    if (entry.blockers?.length) out.push(`Blockers: ${entry.blockers.join("; ")}`);
  } else {
    out.push("Status: not in state.yaml");
  }
  out.push(
    [release ? `Release ${release.number}${release.title ? ` (${release.title})` : ""}` : "Not in a release", priority, effort && `effort ${effort}`]
      .filter(Boolean)
      .join(" · "),
  );
  out.push("", `Feature: intent/${rel(intentDir, file)}`);
  for (const line of feature.description.split("\n").map((l) => l.trim()).filter(Boolean)) out.push(`  ${line}`);
  out.push("", "Scenarios:");
  for (const s of scenariosOf(feature)) out.push(`  ${s.name}`);

  const versions = planVersions(intentDir, story);
  out.push("");
  if (versions.length) {
    const v = versions.at(-1)!;
    const plan = parseBet(read(join(intentDir, "plans", `${story}.v${v}.md`)));
    out.push(`Plan: v${v} (intent/plans/${story}.v${v}.md)${plan?.meta?.summary ? ` — ${plan.meta.summary}` : ""}`);
  } else {
    out.push("Plan: none yet");
  }

  const bets = walk(join(intentDir, "bets"), ".md")
    .map((p) => parseBet(read(p))?.meta)
    .filter((m) => Array.isArray(m?.stories) && m.stories.includes(story));
  out.push(bets.length ? `Bets: ${bets.map((b) => `${b.id} (${b.status}, ends ${b.time_box}, intent/bets/${b.id}.md)`).join(", ")}` : "Bets: none");

  const decisions = decisionEntries(dir).filter((e) => e.title.includes(`(${story})`));
  out.push(decisions.length ? "Decisions:" : "Decisions: none recorded for this story");
  for (const d of decisions) out.push(`  intent/decisions.md:${d.start} ${d.title}`);
  return out.join("\n");
}

export function runShow(args: string[]): number {
  const [story, ...rest] = args;
  if (!story) {
    console.error("Usage: nikos show <story-id> [--dir <path>]");
    return 1;
  }
  const i = rest.indexOf("--dir");
  try {
    console.log(show(story, i >= 0 ? rest[i + 1] : process.cwd()));
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
