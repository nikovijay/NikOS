// planning/repos.yaml: the code repos a planning repo reads delivery from. Its version is the
// file's own (version: 1). It is read tolerantly, so a newer nikOS's extra fields are kept, and a
// newer version is refused with the upgrade message. Writers here stay strict about the shape.
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { REPO_PATH } from "../lib/bets.js";
import { contractProblems, NewerContractError } from "../lib/schema.js";
import { store } from "../lib/store.js";
import { writePlanning, type PlanningIssue } from "../planning/model.js";

export interface RepoEntry {
  repo: string;
  host?: string;
  ref?: string;
  url?: string;
  [extra: string]: unknown;
}

export interface ReposDoc {
  version: 1;
  repos: RepoEntry[];
  [extra: string]: unknown;
}

const FILE = "planning/repos.yaml";
export const reposPath = (repo: string) => join(repo, "planning", "repos.yaml");

/** The file as data, or undefined when the planning repo has none. A file that doesn't parse throws. */
function readReposFile(repo: string): unknown {
  if (!store().exists(reposPath(repo))) return undefined;
  try {
    return parse(store().read(reposPath(repo)));
  } catch {
    throw new Error(`${FILE} doesn't read as YAML`);
  }
}

/** What's wrong with the file's data. A newer version throws NewerContractError, as the tolerant readers do. */
function reposProblems(data: unknown): string[] {
  const problems = contractProblems("repos.yaml", data, "version", "planning", "planning/repos.schema.json");
  const repos = (data as { repos?: unknown } | null)?.repos;
  if (!problems.length && Array.isArray(repos)) {
    repos.forEach((e: any, i: number) => {
      if (typeof e?.repo === "string" && !REPO_PATH.test(e.repo)) problems.push(`repos.${i}.repo: '${e.repo}' isn't a repo path (owner/repo, or group/subgroup/project on GitLab)`);
    });
  }
  return problems;
}

/**
 * planning/repos.yaml, checked. A planning repo with no file lists no repos. A newer version throws
 * NewerContractError; any other problem throws with the problems named.
 */
export function loadRepos(repo: string): ReposDoc {
  const data = readReposFile(repo);
  if (data === undefined) return { version: 1, repos: [] };
  const problems = reposProblems(data);
  if (problems.length) throw new Error(`${FILE}: ${problems.join("; ")}`);
  return data as ReposDoc;
}

/** The problems with planning/repos.yaml for plan validate: none when there is no file or it is right. */
export function reposIssues(repo: string): PlanningIssue[] {
  let data: unknown;
  try {
    data = readReposFile(repo);
  } catch {
    return [{ file: FILE, message: "doesn't read as YAML" }];
  }
  if (data === undefined) return [];
  try {
    return reposProblems(data).map((message) => ({ file: FILE, message }));
  } catch (err) {
    if (err instanceof NewerContractError) return [{ file: FILE, message: err.message }];
    throw err;
  }
}

/**
 * The list with an entry added. A repo already listed (compared without case) is left as it is, and
 * added is false.
 */
export function addRepo(doc: ReposDoc, entry: RepoEntry): { doc: ReposDoc; added: boolean } {
  const want = entry.repo.toLowerCase();
  if (doc.repos.some((e) => e.repo.toLowerCase() === want)) return { doc, added: false };
  return { doc: { ...doc, repos: [...doc.repos, entry] }, added: true };
}

/** Write planning/repos.yaml with the list as it is. */
export function writeRepos(repo: string, doc: ReposDoc): void {
  const text = `# The code repos this planning repo reads delivery from. nikos plan refresh reads each one, read-only.\n${stringify(doc, { lineWidth: 0 })}`;
  writePlanning(repo, reposPath(repo), text, { create: !store().exists(reposPath(repo)) });
}
