// `nikos export`: the story map in a shape another tool reads. A PRD in Markdown for people;
// JSON for Linear (one issue per story, fields named as in Linear's IssueCreateInput) and Jira
// (the body of POST /rest/api/2/issue/bulk). The story map stays the source: these are copies.
import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { isDone } from "../lib/project.js";
import { resolveStoryMap } from "../lib/maps.js";
import { storyMapOfRef, type MapRelease, type MapStory, type StoryMap } from "./map.js";

export const FORMATS = ["prd", "linear", "jira"] as const;
export type Format = (typeof FORMATS)[number];

const STATUS_WORD: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  needs_rework: "Needs rework",
  done: "Done",
  approved: "Approved",
  cancelled: "Cancelled",
};
const TYPE_WORD: Record<string, string> = { user_story: "User story", technical: "Technical", bug_risk: "Bug risk" };
const label = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const live = (r: MapRelease) => r.stories.filter((s) => s.status !== "cancelled");

function activityOf(m: StoryMap, s: MapStory) {
  const a = m.activities.find((x) => x.id === s.activity);
  return { activity: a?.title ?? s.activity, step: a?.steps.find((st) => st.id === s.step)?.title ?? s.step };
}

/** The facts line under a story: status, type, priority, effort, personas, dependencies. */
function facts(m: StoryMap, s: MapStory): string[] {
  const persona = (id: string) => m.personas.find((p) => p.id === id)?.title ?? id;
  const { activity, step } = activityOf(m, s);
  return [
    `Status: ${STATUS_WORD[s.status] ?? s.status}${s.status === "approved" && s.approvedBy ? ` by ${s.approvedBy}` : ""}`,
    TYPE_WORD[s.type] && s.type !== "user_story" ? `Type: ${TYPE_WORD[s.type]}` : "",
    s.priority && `Priority: ${s.priority}`,
    s.effort && `Effort: ${s.effort}`,
    activity && `Activity: ${activity}${step ? ` › ${step}` : ""}`,
    s.personas.length ? `For: ${s.personas.map(persona).join(", ")}` : "",
    s.dependsOn.length ? `Depends on: ${s.dependsOn.join(", ")}` : "",
  ].filter(Boolean);
}

export function toPrd(m: StoryMap): string {
  const out = [`# ${m.project || "Product"}: product requirements`, "", "Exported from the nikOS story map (maps/<key>/storymap.yaml). Edit the story map, not this file.", ""];
  if (m.personas.length) {
    out.push("## Who it's for", "");
    for (const p of m.personas) out.push(`- **${p.title}**${p.description ? `: ${p.description}` : ""}`);
    out.push("");
  }
  for (const r of m.releases) {
    const stories = live(r);
    out.push(`## Release ${r.number}: ${r.title}`, "");
    if (r.goal) out.push(`**Goal:** ${r.goal}`, "");
    if (r.bets.length) out.push(`**Delivers:** ${r.bets.join(", ")}`, "");
    out.push(`${stories.filter((s) => isDone(s.status)).length} of ${stories.length} ${stories.length === 1 ? "story" : "stories"} done.`, "");
    for (const s of stories) {
      out.push(`### ${s.id}: ${s.title}`, "");
      if (s.narrative) out.push(s.narrative, "");
      out.push(facts(m, s).join(" · "), "");
      if (s.criteria.length) {
        out.push("Acceptance criteria:", "");
        for (const c of s.criteria) out.push(`- ${c.id ? `${c.id}: ` : ""}${c.title}${c.priority ? ` (${c.priority})` : ""}`);
        out.push("");
      }
    }
  }
  const cancelled = m.releases.flatMap((r) => r.stories).filter((s) => s.status === "cancelled");
  if (cancelled.length) {
    out.push("## Cancelled", "");
    for (const s of cancelled) out.push(`- ${s.id}: ${s.title}${s.cancelledReason ? `. ${s.cancelledReason}` : ""}`);
    out.push("");
  }
  return out.join("\n");
}

/** A story's description as Markdown (Linear) or Jira wiki markup. */
function body(m: StoryMap, s: MapStory, wiki: boolean): string {
  const lines = [s.narrative, "", ...facts(m, s).map((f) => (wiki ? `* ${f}` : `- ${f}`))];
  if (s.criteria.length) {
    lines.push("", wiki ? "h3. Acceptance criteria" : "### Acceptance criteria");
    for (const c of s.criteria) lines.push(`${wiki ? "#" : "1."} ${c.id ? `${c.id}: ` : ""}${c.title}${c.priority ? ` (${c.priority})` : ""}`);
  }
  return lines.join("\n").trim();
}

const LINEAR_PRIORITY: Record<string, number> = { must: 2, should: 3, could: 4 };
const ESTIMATE: Record<string, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };
const LINEAR_STATE: Record<string, string> = { todo: "Todo", in_progress: "In Progress", needs_rework: "In Progress", done: "Done", approved: "Done" };

/** One Linear issue per story; releases become milestones. State and labels are names to map to ids. */
export function toLinear(m: StoryMap) {
  return {
    format: "nikos-linear/1",
    project: m.project,
    milestones: m.releases.map((r) => ({ name: `Release ${r.number}: ${r.title}`, description: r.goal })),
    issues: m.releases.flatMap((r) =>
      live(r).map((s) => {
        const { activity, step } = activityOf(m, s);
        return {
          externalId: s.id,
          title: `${s.id} ${s.title}`,
          description: body(m, s, false),
          priority: LINEAR_PRIORITY[s.priority] ?? 0,
          ...(ESTIMATE[s.effort] ? { estimate: ESTIMATE[s.effort] } : {}),
          stateName: LINEAR_STATE[s.status] ?? "Todo",
          milestoneName: `Release ${r.number}: ${r.title}`,
          labelNames: [activity, step, s.type !== "user_story" ? TYPE_WORD[s.type] : "", ...s.personas].filter(Boolean),
          blockedBy: s.dependsOn,
        };
      }),
    ),
  };
}

const JIRA_PRIORITY: Record<string, string> = { must: "High", should: "Medium", could: "Low" };

/** The body of Jira's bulk create (POST /rest/api/2/issue/bulk). Jira can't set status on create. */
export function toJira(m: StoryMap, projectKey: string) {
  return {
    issueUpdates: m.releases.flatMap((r) =>
      live(r).map((s) => ({
        fields: {
          project: { key: projectKey },
          summary: `${s.id} ${s.title}`,
          description: body(m, s, true),
          issuetype: { name: s.type === "user_story" ? "Story" : "Task" },
          ...(JIRA_PRIORITY[s.priority] ? { priority: { name: JIRA_PRIORITY[s.priority] } } : {}),
          labels: [`nikos-${label(s.id)}`, `release-${r.number}`, label(s.activity), label(s.step), s.type !== "user_story" ? label(s.type) : "", `status-${label(s.status)}`, ...s.personas.map(label)].filter(Boolean),
        },
      })),
    ),
  };
}

export function exportMap(dir: string, format: Format, opts: { release?: number; projectKey?: string; map?: string } = {}): string {
  if (!FORMATS.includes(format)) throw new Error(`'${format}' is not a format (${FORMATS.join(", ")})`);
  // Several maps need a pick: exporting none of them would print an empty story map.
  const full = storyMapOfRef(resolveStoryMap(dir, { map: opts.map }));
  if (opts.release !== undefined && !full.releases.some((r) => r.number === opts.release)) {
    throw new Error(`There is no release ${opts.release}. Releases: ${full.releases.map((r) => r.number).join(", ")}`);
  }
  const m = opts.release === undefined ? full : { ...full, releases: full.releases.filter((r) => r.number === opts.release) };
  if (format === "prd") return toPrd(m);
  const json = format === "linear" ? toLinear(m) : toJira(m, opts.projectKey ?? (full.key || "PROJ"));
  return JSON.stringify(json, null, 2) + "\n";
}

const DEFAULT_OUT: Record<Format, string> = { prd: "storymap-prd.md", linear: "storymap-linear.json", jira: "storymap-jira.json" };

export function runExport(args: string[]): number {
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const format = flag("format") as Format | undefined;
  if (!format) {
    console.error('Usage: nikos export --format <prd|linear|jira> [--release <n>] [--out <file>] [--project-key <KEY>] [--dir <path>]');
    return 1;
  }
  try {
    const release = flag("release");
    const text = exportMap(resolve(flag("dir") ?? process.cwd()), format, { release: release === undefined ? undefined : Number(release), projectKey: flag("project-key"), map: flag("map") });
    const out = resolve(flag("out") ?? DEFAULT_OUT[format]);
    writeFileSync(out, text);
    const shown = relative(process.cwd(), out);
    console.log(`Wrote ${shown && !shown.startsWith("..") ? shown : out}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
