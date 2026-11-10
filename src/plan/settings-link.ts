// nikos.plan.yaml: a code repo's link to its planning repo, and a snapshot of the settings its maps take
// from the plan (rule 6 of docs/rfcs/plan-and-spec.md). nikos settings pull refreshes the snapshot from
// the plan, so the code repo reads its settings from a committed file with no network. The sha256 catches
// a hand edit. It is a check, not security.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { parse, stringify } from "yaml";
import { errorLine, fetchCopy, urlProblem } from "../lib/fetch-copy.js";
import { branchExists, currentBranch, gitIn } from "../lib/git.js";
import { mapDirs, mapOwnerOf } from "../lib/maps.js";
import { areaSettingsFile, checkSettingsText, SETTINGS_FILE } from "../lib/settings.js";
import { contractVersion, NewerContractError, schemaProblems } from "../lib/schema.js";
import { store } from "../lib/store.js";
import { isPlanRepo, type Area } from "../planning/model.js";
import { chainOf, listAreas, oldLayoutProblem } from "./repo.js";

export const LINK_FILE = "nikos.plan.yaml";
/** The branch a code repo's link is committed on, the way the planning repo's listing is on nikos/join. */
export const LINK_BRANCH = "nikos/link";
const HEADER = "# nikOS: this repo's link to its planning repo, and the settings its maps take from it.\n# nikos settings pull refreshes it. Don't edit it by hand.\n";

/** A settings file in the snapshot: the folder it came from (e.g. teams/WEB) and its data. */
export interface LinkLevel {
  rel: string;
  data: Record<string, unknown>;
}

export interface PlanRef {
  repo: string;
  host?: string;
  url?: string;
}

export interface PlanLink {
  format_version: 1;
  plan: PlanRef;
  read: { commit: string; at: string; ref?: string };
  /** The company's settings file, if it has one. Every map takes these. */
  company: LinkLevel[];
  /** Each owning team's levels below the company, keyed by the team's key. */
  owners: Record<string, { levels: LinkLevel[] }>;
  /** Each story map's bound owner when the snapshot was taken, keyed by the map's folder. "" is no owner. */
  maps: Record<string, string>;
  sha256: string;
}

// Keys sorted at every depth, so the same settings always hash the same.
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v;

/** The hash of a snapshot's settings and the owners its maps are bound to. The link's time and plan details aren't in it. */
export const snapshotHash = (s: Pick<PlanLink, "company" | "owners" | "maps">) =>
  createHash("sha256").update(JSON.stringify(sorted({ company: s.company, owners: s.owners, maps: s.maps }))).digest("hex");

/** The link, if this repo has one. A file that doesn't read throws, naming the problem. */
export function readLink(root: string): PlanLink | undefined {
  const path = join(root, LINK_FILE);
  return store().exists(path) ? parseLink(store().read(path)) : undefined;
}

/** The link committed on nikos/link, when this repo has one there. A link that doesn't read is treated as none. */
export function linkOnBranch(root: string): PlanLink | undefined {
  if (!branchExists(root, LINK_BRANCH)) return undefined;
  const shown = gitIn(root, ["show", `${LINK_BRANCH}:${LINK_FILE}`]);
  if (shown.status !== 0) return undefined;
  try {
    return parseLink(shown.stdout);
  } catch {
    return undefined;
  }
}

/**
 * A note for a branch that doesn't hold the link while nikos/link does: this branch takes the plan's settings
 * only once nikos/link is merged to it. Undefined when the link is here, or nothing is on nikos/link.
 */
export function linkBranchNote(root: string): string | undefined {
  if (store().exists(join(root, LINK_FILE)) || currentBranch(root) === LINK_BRANCH) return undefined;
  const there = linkOnBranch(root);
  if (!there) return undefined;
  return `${there.plan.repo}'s settings are on ${LINK_BRANCH}, not on this branch, so this branch doesn't take them yet. They apply here once ${LINK_BRANCH} is merged`;
}

/** A link's text, read and checked. A file that doesn't read throws, naming the problem. */
export function parseLink(text: string): PlanLink {
  let data: unknown;
  try {
    data = parse(text);
  } catch (err) {
    throw new Error(`${LINK_FILE} doesn't read as YAML: ${(err as Error).message.split("\n")[0]}`);
  }
  const newer = contractVersion(LINK_FILE, data, "format_version", "code");
  if (newer) throw new NewerContractError(newer);
  const problems = schemaProblems("plan-link.schema.json", data);
  if (problems.length) throw new Error(`${LINK_FILE} doesn't read: ${problems.join("; ")}`);
  return data as PlanLink;
}

/** A snapshot older than this many days is stale: doctor warns, and the plan may have moved on. */
export const SNAPSHOT_STALE_DAYS = 14;

/**
 * The map owners this repo's storymaps name that the snapshot doesn't match: a map the snapshot doesn't know,
 * or one whose owner changed since the snapshot. Each names the map, so a fix can point at it.
 */
export function bindingProblems(root: string, link: PlanLink): string[] {
  return mapDirs(root).flatMap((dir) => {
    const id = basename(dir);
    const owner = mapOwnerOf(dir) ?? "";
    if (!(id in link.maps)) return [`maps/${id} isn't in ${LINK_FILE} yet`];
    if (link.maps[id] !== owner) return [`maps/${id}'s owner is ${owner || "none"}, but ${LINK_FILE} takes its settings from ${link.maps[id] || "no owner"}`];
    return [];
  });
}

/**
 * Why the link can't be trusted, or undefined: its settings were edited by hand, or a map's owner in its
 * storymap no longer matches the snapshot. Throws when the link doesn't read. validate reports it, so CI catches it.
 */
export function linkProblem(root: string): string | undefined {
  const link = readLink(root);
  if (!link) return undefined;
  if (link.sha256 !== snapshotHash(link)) return "its settings were edited by hand: run nikos settings pull to refresh them from the plan";
  const gaps = bindingProblems(root, link);
  return gaps.length ? `${gaps.join("; ")}: run nikos settings pull to take them from the plan, then commit it` : undefined;
}

/**
 * The commit the plan's branch is at now, from git ls-remote, or the line of git's error when the plan
 * can't be reached. This is the one network read in the settings link, and only doctor makes it (not offline).
 */
export function planHead(link: PlanLink): { commit: string } | { error: string } {
  const url = link.plan.url ?? `https://${link.plan.host ?? "github.com"}/${link.plan.repo}.git`;
  const bad = urlProblem(url);
  if (bad) return { error: bad };
  const ref = link.read.ref ?? "HEAD";
  // "--" ends the options, so a url can never be read as one.
  const r = spawnSync("git", ["ls-remote", "--", url, ref], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (r.status !== 0) return { error: errorLine(r.stderr || "") };
  const rows = r.stdout.split("\n").filter((l) => l.trim()).map((l) => l.split("\t"));
  const row = rows.find((c) => c[1] === `refs/heads/${ref}`) ?? rows[0];
  return row ? { commit: row[0] } : { error: `${ref} isn't on ${link.plan.repo}` };
}

/** Write the link at the code repo's root, with its hash set from the settings in it. */
export function writeLink(root: string, link: PlanLink): string {
  const path = join(root, LINK_FILE);
  store().write(path, HEADER + stringify({ ...link, sha256: snapshotHash(link) }, { lineWidth: 0 }));
  return path;
}

/** Each story map's owner from its storymap.yaml, keyed by the map's folder. "" is no owner. */
export function mapBindings(root: string): Record<string, string> {
  return Object.fromEntries(mapDirs(root).map((dir) => [basename(dir), mapOwnerOf(dir) ?? ""]));
}

/**
 * One area's settings file as a level, or none when it has no file. A file that doesn't read throws,
 * naming the file: the snapshot is all or nothing.
 */
function levelOf(area: Area): LinkLevel[] {
  const path = areaSettingsFile(area);
  if (!store().exists(path)) return [];
  const text = store().read(path);
  const bad = checkSettingsText(text);
  if (bad) throw new Error(`${relative(area.repo, path)} doesn't read: ${bad.replace(`${SETTINGS_FILE}: `, "")}`);
  return [{ rel: area.rel, data: parse(text) ?? {} }];
}

/**
 * The settings snapshot for some owners, from a planning repo's copy: the company's file, and each
 * owner's team chain below the company. An owner with no team in the plan gets no entry, so its maps
 * take the company's settings only, and a warning says so.
 */
export function snapshotOf(copy: string, owners: string[]): { company: LinkLevel[]; owners: PlanLink["owners"]; warnings: string[] } {
  const areas = listAreas(copy);
  const company = areas.find((a) => a.level === "company");
  const out: PlanLink["owners"] = {};
  const warnings: string[] = [];
  for (const owner of [...new Set(owners)].sort()) {
    const team = areas.find((a) => a.level === "team" && a.id === owner);
    if (!team) {
      warnings.push(`${owner} has no team area in the plan, so its maps take the company's settings only`);
      continue;
    }
    out[owner] = { levels: chainOf(team).filter((a) => a.level !== "company").flatMap(levelOf) };
  }
  return { company: company ? levelOf(company) : [], owners: out, warnings };
}

export interface PullResult {
  link: PlanLink;
  warnings: string[];
}

/**
 * The link for a copy of the plan: its snapshot for the owners the maps are bound to, read at a commit.
 * Used by join (the first snapshot) and by pull (a refresh). Throws, naming the file, when a settings file doesn't read.
 */
export function linkFromCopy(copy: string, plan: PlanRef, read: PlanLink["read"], maps: Record<string, string>): PullResult {
  const snap = snapshotOf(copy, [...new Set(Object.values(maps).filter(Boolean))]);
  const link: PlanLink = { format_version: 1, plan, read, company: snap.company, owners: snap.owners, maps, sha256: "" };
  return { link: { ...link, sha256: snapshotHash(link) }, warnings: snap.warnings };
}

/**
 * Refresh the snapshot in this code repo's nikos.plan.yaml from its planning repo. Only the plan's
 * planning/ folder and its root settings file are read (a sparse clone). Nothing is written unless every
 * settings file reads: a failure keeps the last snapshot and names what broke.
 */
export function pullPlanSettings(root: string): PullResult {
  const prior = readLink(root);
  if (!prior) {
    const there = linkOnBranch(root);
    if (there) throw new Error(`This repo's link to ${there.plan.repo} is on ${LINK_BRANCH}, not on this branch. Switch to it with git switch ${LINK_BRANCH}, then pull.`);
    throw new Error("This repo isn't linked to a planning repo, so there are no settings to pull. Link it with nikos join <owner/repo>.");
  }
  const { repo, host } = prior.plan;
  const url = prior.plan.url ?? `https://${host ?? "github.com"}/${repo}.git`;
  const tmp = mkdtempSync(join(tmpdir(), "nikos-pull-"));
  try {
    const copy = join(tmp, "plan");
    // Cone mode keeps a repo's root files, so the sparse paths name folders only: a file path there fails the sparse step.
    const got = fetchCopy(url, prior.read.ref, copy, ["planning"]);
    if ("error" in got) throw new Error(`Couldn't read ${repo}: ${got.error}. The last snapshot is kept.`);
    const old = oldLayoutProblem(copy);
    if (old) throw new Error(`${repo}: ${old} The last snapshot is kept.`);
    if (!isPlanRepo(copy)) throw new Error(`${repo} isn't a planning repo. The last snapshot is kept.`);
    const ref = prior.read.ref;
    let pulled: PullResult;
    try {
      pulled = linkFromCopy(copy, prior.plan, { commit: got.commit, at: new Date().toISOString(), ...(ref ? { ref } : {}) }, mapBindings(root));
    } catch (err) {
      throw new Error(`${(err as Error).message}. Nothing was pulled, and the last snapshot is kept.`);
    }
    writeLink(root, pulled.link);
    return pulled;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
