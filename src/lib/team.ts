// A team repo: its code, plus nikos.team.yaml, which names the team, the group repos it takes
// work from, and its members. Teams keep their status and delivery approvals in status/ and
// approvals/, and read the stories assigned to them from .nikos/assigned/ (see team/sync.ts).
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse, parseDocument, type Document } from "yaml";
import { store } from "./store.js";
import { schemaProblems } from "./schema.js";
import { read } from "./project.js";
import { REPO_PATH } from "./bets.js";

export const TEAM_FILE = "nikos.team.yaml";

/** The refusal for stories written in a team repo: they're authored in the group repo. */
export const TEAM_REPO_STORIES = "this is a team repo: stories are added in the group repo";

/** A team repo can't also keep its own story map (intent/ or maps/): nikos migrate maps refuses it, and the person moves intent/ into a group repo. Returns the refusal, or undefined. */
export function storyMapClash(root: string): string | undefined {
  if (!store().isDir(join(root, "intent")) && !store().isDir(join(root, "maps"))) return undefined;
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
  format_version: 1;
  name: string;
  repo: string;
  groups: TeamGroup[];
  members: TeamMember[];
}

/** Whether this repo is a team repo: it has nikos.team.yaml. */
export const isTeamRepo = (root: string): boolean => store().exists(join(root, TEAM_FILE));

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

/** The folder under .nikos/assigned/ that holds a group's copy: its repo path, nested by folder. */
export const copyDirOf = (root: string, repo: string) => join(root, ".nikos", "assigned", ...repo.split("/"));

/** A repo path from a command line, with `.` allowed for the group repo itself. */
export const isRepoArg = (s: string) => s === "." || REPO_PATH.test(s);

/** Relative path from a folder to a file, with forward slashes. */
export const relPath = (from: string, to: string) => relative(from, to).split(sep).join("/");

/** Make sure .nikos/ is gitignored, so the copies of assigned stories are never committed. */
export function ignoreAssigned(root: string): void {
  const p = join(root, ".gitignore");
  const text = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (/^\/?\.nikos\/?$/m.test(text)) return;
  appendFileSync(p, `${text && !text.endsWith("\n") ? "\n" : ""}# nikos sync: read-only copies of the stories assigned to this team\n.nikos/\n`);
}
