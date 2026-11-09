// A team repo: its code, plus nikos.team.yaml, which names the team, the repos it takes work from,
// and its members. A team keeps its own story maps in maps/<key>/, with its status and delivery
// approvals in each map's own folder.
import { join } from "node:path";
import { parse, parseDocument, type Document } from "yaml";
import { store } from "./store.js";
import { schemaProblems } from "./schema.js";
import { read } from "./project.js";

export const TEAM_FILE = "nikos.team.yaml";

/** The refusal for stories written in a team repo: they're authored in the group repo. */
export const TEAM_REPO_STORIES = "this is a team repo: stories are added in the group repo";

/**
 * A team repo can't keep the single story map of a 0.3.0 repo (intent/): its own maps live in maps/<key>/
 * (the amendment), and nikos migrate maps moves intent/ there. Returns the refusal, or undefined.
 */
export function storyMapClash(root: string): string | undefined {
  if (!store().isDir(join(root, "intent"))) return undefined;
  return "this repo has intent/ or maps/ and nikos.team.yaml: keep one";
}

export interface TeamGroup {
  repo: string;
  ref?: string;
  host?: string;
  url?: string;
}
export interface TeamMember {
  name: string;
  role?: string;
  handle?: string;
}
export interface TeamFile {
  /** 2 when the team has a key or a home (0.3.0 can't read it); 1 otherwise. Written by nikos team init and nikos join --home. */
  format_version: 1 | 2;
  name: string;
  repo: string;
  /** The team's key (WEB): its story ids are WEB-<map>-<n> once it owns a map. Shares one namespace with group keys. */
  key?: string;
  /** The plan the team is homed in: its settings and locks come from there. */
  home?: string;
  groups: TeamGroup[];
  members: TeamMember[];
}

/** Whether this repo is a team repo: it has nikos.team.yaml. */
export const isTeamRepo = (root: string): boolean => store().exists(join(root, TEAM_FILE));

/**
 * Whether a team repo has taken up the amendment: a key, a home, or a map of its own. Until it has,
 * the repo is refused by the team commands and read as in 0.3.0. A joined plan alone doesn't count:
 * a 0.3.0 group that is also a team can have joined one.
 */
export function teamOptedIn(root: string): boolean {
  try {
    const team = openTeam(root);
    if (team.key || team.home) return true;
  } catch {
    return false;
  }
  return store().isDir(join(root, "maps"));
}

/** The team repo a folder is in, walking up to nikos.team.yaml, or undefined. */
export function teamRootOf(dir: string): string | undefined {
  let at = dir;
  for (;;) {
    if (isTeamRepo(at)) return at;
    const up = join(at, "..");
    if (up === at) return undefined;
    at = up;
  }
}

/** The team file's text, checked against its schema and given defaults. Throws with the first problem. */
export function parseTeam(text: string): TeamFile {
  const data: any = parse(text) ?? {};
  const problems = schemaProblems("team.schema.json", data);
  if (problems.length) throw new Error(`${TEAM_FILE}: ${problems[0]}`);
  // A key and a home are part of format 2: a format 1 file with either is refused rather than read as a 0.3.0 team.
  if (data.home !== undefined && data.format_version !== 2) throw new Error(`${TEAM_FILE}: home needs format_version 2`);
  if (data.key !== undefined && data.format_version !== 2) throw new Error(`${TEAM_FILE}: key needs format_version 2`);
  return { ...data, groups: data.groups ?? [], members: data.members ?? [] };
}

/** The team in a team repo, read and checked. */
export function openTeam(root: string): TeamFile {
  return parseTeam(read(join(root, TEAM_FILE)));
}

/** A team file as a Document, so edits keep its comments and order. */
export const teamDocument = (root: string): Document => parseDocument(read(join(root, TEAM_FILE)));

/** Check a team document against the schema, then write it. Throws without writing when it's wrong. */
export function saveTeam(root: string, doc: Document): void {
  const problems = schemaProblems("team.schema.json", doc.toJSON());
  if (problems.length) throw new Error(`${TEAM_FILE}: ${problems[0]}`);
  store().write(join(root, TEAM_FILE), doc.toString({ flowCollectionPadding: false }));
}

/**
 * Group paths that would collide on disk: one can't be a folder above another (a/b and a/b/c).
 * Returns the offending pair, or undefined.
 */
export function clashingGroups(repos: string[]): [string, string] | undefined {
  for (const a of repos) for (const b of repos) if (a !== b && b.startsWith(`${a}/`)) return [a, b];
  return undefined;
}
