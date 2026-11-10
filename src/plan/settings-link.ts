// nikos.plan.yaml: a code repo's link to its planning repo, and a snapshot of the settings its maps take
// from the plan (rule 6 of docs/rfcs/plan-and-spec.md). nikos settings pull refreshes the snapshot from
// the plan, so the code repo reads its settings from a committed file with no network. The sha256 catches
// a hand edit. It is a check, not security.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parse, stringify } from "yaml";
import { fetchCopy } from "../lib/fetch-copy.js";
import { mapDirs, mapOwnerOf } from "../lib/maps.js";
import { areaSettingsFile, checkSettingsText, SETTINGS_FILE } from "../lib/settings.js";
import { contractVersion, NewerContractError, schemaProblems } from "../lib/schema.js";
import { store } from "../lib/store.js";
import { isPlanRepo, type Area } from "../planning/model.js";
import { chainOf, listAreas, oldLayoutProblem } from "./repo.js";

export const LINK_FILE = "nikos.plan.yaml";
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
  sha256: string;
}

// Keys sorted at every depth, so the same settings always hash the same.
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v;

/** The hash of a snapshot's settings. The link's time and plan details aren't in it. */
export const snapshotHash = (s: Pick<PlanLink, "company" | "owners">) => createHash("sha256").update(JSON.stringify(sorted({ company: s.company, owners: s.owners }))).digest("hex");

/** The link, if this repo has one. A file that doesn't read throws, naming the problem. */
export function readLink(root: string): PlanLink | undefined {
  const path = join(root, LINK_FILE);
  if (!store().exists(path)) return undefined;
  let data: unknown;
  try {
    data = parse(store().read(path));
  } catch (err) {
    throw new Error(`${LINK_FILE} doesn't read as YAML: ${(err as Error).message.split("\n")[0]}`);
  }
  const newer = contractVersion(LINK_FILE, data, "format_version", "code");
  if (newer) throw new NewerContractError(newer);
  const problems = schemaProblems("plan-link.schema.json", data);
  if (problems.length) throw new Error(`${LINK_FILE} doesn't read: ${problems.join("; ")}`);
  return data as PlanLink;
}

/** Why the link's settings can't be trusted (edited by hand), or undefined. Throws when the link doesn't read. */
export function linkProblem(root: string): string | undefined {
  const link = readLink(root);
  if (link && link.sha256 !== snapshotHash(link)) return `${LINK_FILE}'s settings were edited by hand: run nikos settings pull to refresh them from the plan`;
  return undefined;
}

/** Write the link at the code repo's root, with its hash set from the settings in it. */
export function writeLink(root: string, link: PlanLink): string {
  const path = join(root, LINK_FILE);
  store().write(path, HEADER + stringify({ ...link, sha256: snapshotHash(link) }, { lineWidth: 0 }));
  return path;
}

/** The owners the code repo's maps name, from each storymap.yaml, sorted and without repeats. */
export function mapOwners(root: string): string[] {
  return [...new Set(mapDirs(root).map(mapOwnerOf).filter((o): o is string => !!o))].sort();
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
 * Refresh the snapshot in this code repo's nikos.plan.yaml from its planning repo. Only the plan's
 * planning/ folder and its root settings file are read (a sparse clone). Nothing is written unless every
 * settings file reads: a failure keeps the last snapshot and names what broke.
 */
export function pullPlanSettings(root: string): PullResult {
  const prior = readLink(root);
  if (!prior) throw new Error("This repo isn't linked to a planning repo, so there are no settings to pull. Link it with nikos join <owner/repo>.");
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
    let snap: ReturnType<typeof snapshotOf>;
    try {
      snap = snapshotOf(copy, mapOwners(root));
    } catch (err) {
      throw new Error(`${(err as Error).message}. Nothing was pulled, and the last snapshot is kept.`);
    }
    const ref = prior.read.ref;
    const link: PlanLink = {
      format_version: 1,
      plan: prior.plan,
      read: { commit: got.commit, at: new Date().toISOString(), ...(ref ? { ref } : {}) },
      company: snap.company,
      owners: snap.owners,
      sha256: "",
    };
    writeLink(root, link);
    return { link: { ...link, sha256: snapshotHash(link) }, warnings: snap.warnings };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
