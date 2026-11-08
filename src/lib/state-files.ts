// Where each story's state and approval live. A repo starts with one file for each:
// intent/state.yaml (stories:) and intent/approvals.yaml (approvals:). Once several people or
// agents work in one repo, `nikos migrate per-story` moves every story to its own file,
// intent/state/<ID>.yaml and intent/approvals/<ID>.yaml, so two branches that move different
// stories never touch the same file and never conflict. state.yaml keeps format_version and the
// run queue. Everything reads and writes stories through here, so both layouts work the same.
// A team repo keeps one file per story too: status/<ID>.yaml and approvals/<ID>.yaml.
import { join } from "node:path";
import { Document, parse, parseDocument, stringify } from "yaml";
import { read } from "./project.js";
import { store } from "./store.js";

export type StoryState = {
  status: string;
  claimed_by?: string;
  plan_version?: number;
  blockers?: string[];
  updated?: string;
  spec_hash?: string;
  done_at?: string;
  cancelled_reason?: string;
  ticket?: string;
  tested_commit?: string;
  evidence?: { run_at: string; runner: string; commit: string; ok: boolean };
  reassigned_to?: string;
  reassigned_on?: string;
};

/**
 * Where a story's state lives: an intent or map folder (the group and single-team layouts), or a
 * team repo, which keeps status/ and approvals/ at its root.
 */
export type StoryHome = string | { team: string };

export const statePath = (intentDir: string) => join(intentDir, "state.yaml");
export const stateDir = (intentDir: string) => join(intentDir, "state");
export const approvalsFile = (intentDir: string) => join(intentDir, "approvals.yaml");
export const approvalsDir = (intentDir: string) => join(intentDir, "approvals");
export const storyStatePath = (intentDir: string, id: string) => join(stateDir(intentDir), `${id}.yaml`);
export const storyApprovalPath = (intentDir: string, id: string) => join(approvalsDir(intentDir), `${id}.yaml`);
export const statusDirOf = (team: string) => join(team, "status");
export const teamApprovalsDirOf = (team: string) => join(team, "approvals");

/** The error when a story has no state: named by the file it would be in. */
export const noEntry = (home: StoryHome, id: string) => {
  if (typeof home !== "string") return `${id} has no status file (status/${id}.yaml)`;
  return perStory(home) ? `${id} has no state file (intent/state/${id}.yaml)` : `${id} has no entry in state.yaml`;
};

/** Whether this repo keeps a file per story (intent/state/ exists). */
export const perStory = (intentDir: string) => store().isDir(stateDir(intentDir));

const yamlOut = (doc: Document) => doc.toString({ flowCollectionPadding: false });

/** The .yaml files in a folder, as story id and path. */
export function storyFiles(dir: string): { id: string; path: string }[] {
  if (!store().isDir(dir)) return [];
  return store()
    .list(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => ({ id: f.slice(0, -".yaml".length), path: join(dir, f) }));
}

/** Every story's state: state.yaml's stories, then the per-story files (or a team's status/ files). */
export function loadStates(home: StoryHome): Record<string, StoryState> {
  if (typeof home !== "string") {
    const out: Record<string, StoryState> = {};
    for (const f of storyFiles(statusDirOf(home.team))) {
      const entry = parse(read(f.path));
      if (entry && typeof entry === "object") out[f.id] = entry;
    }
    return out;
  }
  const path = statePath(home);
  const out: Record<string, StoryState> = { ...((store().exists(path) ? parse(read(path))?.stories : undefined) ?? {}) };
  for (const f of storyFiles(stateDir(home))) {
    const entry = parse(read(f.path));
    if (entry && typeof entry === "object") out[f.id] = entry;
  }
  return out;
}

export const storyState = (home: StoryHome, id: string): StoryState | undefined => loadStates(home)[id];

/**
 * Change one story's entry. fn gets a yaml Document and the path to the entry in it, so it can
 * setIn and deleteIn and keep comments and order. The change lands in the story's own file when
 * the repo keeps one per story (or the story already has one), else in state.yaml. A team's
 * change always lands in status/<ID>.yaml.
 */
export function updateStory(home: StoryHome, id: string, fn: (doc: Document, at: string[]) => void, opts: { create?: boolean } = {}): void {
  if (typeof home !== "string") {
    const own = join(statusDirOf(home.team), `${id}.yaml`);
    if (!store().exists(own) && !opts.create) throw new Error(noEntry(home, id));
    const doc = store().exists(own) ? parseDocument(read(own)) : new Document({});
    fn(doc, []);
    store().write(own, yamlOut(doc));
    return;
  }
  const intentDir = home;
  const own = storyStatePath(intentDir, id);
  if (store().exists(own) || (perStory(intentDir) && !hasInStateFile(intentDir, id))) {
    if (!store().exists(own) && !opts.create) throw new Error(noEntry(intentDir, id));
    const doc = store().exists(own) ? parseDocument(read(own)) : new Document({});
    fn(doc, []);
    store().write(own, yamlOut(doc));
    return;
  }
  const doc = parseDocument(read(statePath(intentDir)));
  if (!doc.getIn(["stories", id]) && !opts.create) throw new Error(noEntry(intentDir, id));
  fn(doc, ["stories", id]);
  store().write(statePath(intentDir), yamlOut(doc));
}

function hasInStateFile(intentDir: string, id: string): boolean {
  const path = statePath(intentDir);
  return store().exists(path) && !!parse(read(path))?.stories?.[id];
}

/** Add a new story's entry, in whichever layout the repo uses. */
export function createStoryState(home: StoryHome, id: string, entry: StoryState): void {
  updateStory(home, id, (doc, at) => (at.length ? doc.setIn(at, doc.createNode(entry)) : (doc.contents = doc.createNode(entry) as any)), { create: true });
}

const NEW_APPROVALS = `# Sign-offs on done stories, written by nikos approve. Protect this file with CODEOWNERS
# (e.g. "/intent/approvals.yaml @your-product-lead") so an approval needs that person's review.
format_version: 1
approvals: {}
`;

/** Every approval: approvals.yaml's, then the per-story files (a team's approvals/ folder). */
export function loadApprovalEntries<T>(home: StoryHome): Record<string, T> {
  if (typeof home !== "string") {
    const out: Record<string, T> = {};
    for (const f of storyFiles(teamApprovalsDirOf(home.team))) {
      const entry = parse(read(f.path));
      if (entry && typeof entry === "object") out[f.id] = entry;
    }
    return out;
  }
  const path = approvalsFile(home);
  const out: Record<string, T> = { ...((store().exists(path) ? parse(read(path))?.approvals : undefined) ?? {}) };
  for (const f of storyFiles(approvalsDir(home))) {
    const entry = parse(read(f.path));
    if (entry && typeof entry === "object") out[f.id] = entry;
  }
  return out;
}

/** Record a story's approval: in its own file when the repo keeps one per story, else in approvals.yaml. A team's goes to approvals/<ID>.yaml. */
export function writeApproval(home: StoryHome, id: string, approval: object): string {
  if (typeof home !== "string") {
    const own = join(teamApprovalsDirOf(home.team), `${id}.yaml`);
    store().write(own, stringify(approval));
    return own;
  }
  if (perStory(home) || store().exists(storyApprovalPath(home, id))) {
    const own = storyApprovalPath(home, id);
    store().write(own, stringify(approval));
    return own;
  }
  const path = approvalsFile(home);
  // A Document keeps comments and the other approvals as they were.
  const doc = parseDocument(store().exists(path) ? read(path) : NEW_APPROVALS);
  doc.setIn(["approvals", id], doc.createNode(approval));
  store().write(path, yamlOut(doc));
  return path;
}
