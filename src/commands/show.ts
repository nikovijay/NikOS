import { store } from "../lib/store.js";
import { loadStates, type StoryState } from "../lib/state-files.js";
import { join } from "node:path";
import { parse } from "yaml";
import { approvalLapse, loadApprovals } from "../lib/approvals.js";
import { STORY_ID, decisionsPath, featureTags, isDone, read, rel, specHash } from "../lib/project.js";
import { resolveStoryMap, mapFlag } from "../lib/maps.js";
import { parseFeature, scenariosOf } from "../lint/gherkin.js";
import { codeChangedSince } from "../lib/git.js";
import { featureFor } from "./clear.js";
import { planVersions } from "./plan.js";
import { parseFrontMatter } from "../lib/frontmatter.js";
import { BET_ID, betsFor } from "../lib/bets.js";
import { decisionEntries } from "./decisions.js";

const yamlFile = (path: string) => (store().exists(path) ? parse(read(path)) : undefined);

/** Everything the story map says about one story, in plain text. */
export function show(story: string, dir: string, mapId?: string): string {
  if (!STORY_ID.test(story)) throw new Error(`'${story}' is not a story id (expected e.g. HT-1 or PAY-CHK-12)`);
  const ref = resolveStoryMap(dir, { story, map: mapId });
  const mapDir = ref.dir;
  const home = ref.dir;
  const file = featureFor(story, ref.root, ref.id);
  if (!file) throw new Error(`No feature file is tagged @${story}`);
  const feature = parseFeature(read(file));
  if (!feature) throw new Error(`${rel(ref.root, file)} has no Feature`);

  const tags = feature.tags.map((t) => t.name.slice(1));
  const priority = tags.find((t) => ["must", "should", "could", "wont"].includes(t));
  const effort = tags.find((t) => t.startsWith("effort-"))?.slice(7);
  const map = yamlFile(join(mapDir, "storymap.yaml"));
  const release = (map?.releases ?? []).find((r: any) => (r?.stories ?? []).includes(story));
  const states = loadStates(home);
  const entry: StoryState | undefined = states[story] ?? { status: "todo" };
  const text = read(file);

  const out = [`${story} — ${feature.name}`];
  if (entry) {
    const extra = [entry.claimed_by && `claimed by ${entry.claimed_by}`, entry.updated && `updated ${entry.updated}`].filter(Boolean);
    out.push(`Status: ${entry.status}${extra.length ? ` (${extra.join(", ")})` : ""}`);
    if (entry.blockers?.length) out.push(`Blockers: ${entry.blockers.join("; ")}`);
    const approval = loadApprovals(home)[story];
    if (approval) {
      const lapse = approvalLapse(approval, entry, specHash(text));
      out.push(lapse ? `! Approved by ${approval.by} on ${approval.on}, but that no longer holds: ${lapse}` : `Approved by ${approval.by} on ${approval.on}`);
      // An approval names the commit it was tested at: code committed since is what approve refuses, so say so here too.
      if (!lapse && approval.tested_commit && codeChangedSince(ref.root, approval.tested_commit)) {
        out.push(`! The code has changed since it was tested: run its scenarios again (nikos state set ${story} needs_rework, then in_progress, then done), then approve`);
      }
    }
    if (entry.status === "cancelled") out.push(`Cancelled: ${entry.cancelled_reason ?? "no reason given"}`);
    if (isDone(entry.status) && entry.spec_hash && entry.spec_hash !== specHash(text)) out.push(`! The feature changed after it was ${entry.status}: its scenarios no longer prove it`);
  } else {
    out.push("Status: not in state.yaml");
  }
  out.push(
    [release ? `Release ${release.number}${release.title ? ` (${release.title})` : ""}` : "Not in a release", priority, effort && `effort ${effort}`]
      .filter(Boolean)
      .join(" · "),
  );
  const deps = featureTags(text, "depends");
  if (deps.length) out.push(`Depends on: ${deps.map((d) => `${d} (${states[d]?.status ?? "unknown"})`).join(", ")}`);
  const personas = featureTags(text, "persona");
  if (personas.length) out.push(`For: ${personas.join(", ")}`);
  const type = featureTags(text, "type")[0];
  if (type) out.push(`Type: ${type}`);
  out.push("", `Feature: ${rel(ref.root, file)}`);
  for (const line of feature.description.split("\n").map((l) => l.trim()).filter(Boolean)) out.push(`  ${line}`);
  out.push("", "Scenarios:");
  for (const s of scenariosOf(feature)) out.push(`  ${s.name}`);

  const versions = planVersions(mapDir, story);
  out.push("");
  if (versions.length) {
    const v = versions.at(-1)!;
    const plan = parseFrontMatter(read(join(mapDir, "plans", `${story}.v${v}.md`)));
    out.push(`Plan: v${v} (${rel(ref.root, join(mapDir, "plans", `${story}.v${v}.md`))})${plan?.meta?.summary ? ` — ${plan.meta.summary}` : ""}`);
  } else {
    out.push("Plan: none yet");
  }

  const { bets, from, release: rn } = betsFor(map, story);
  const where = (b: string) => (BET_ID.test(b) ? `${b} (planning/bets/${b}.md)` : b);
  const provenance = from === "map" ? "the story map" : from === "story" ? "the story" : `release ${rn}`;
  out.push(bets.length ? `Bets: ${bets.map(where).join(", ")} — from ${provenance}` : "Bets: none");

  const decisions = decisionEntries(dir).filter((e) => e.title.includes(`(${story})`));
  out.push(decisions.length ? "Decisions:" : "Decisions: none recorded for this story");
  const decisionsFile = rel(ref.root, decisionsPath(ref.root));
  for (const d of decisions) out.push(`  ${decisionsFile}:${d.start} ${d.title}`);
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
    console.log(show(story, i >= 0 ? rest[i + 1] : process.cwd(), mapFlag(rest)));
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
