// Where each story's state and approval live, in its map's folder maps/<key>/. state.yaml keeps
// stories: (and format_version and the run queue), and each approval is its own file,
// approvals/<ID>.yaml, so two branches that move different stories or approve different ones never
// touch the same file. Everything reads and writes stories through here.
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
};

/** A story's home: its map's folder, maps/<key>/. */
export type StoryHome = string;

export const statePath = (home: StoryHome) => join(home, "state.yaml");
export const approvalsDir = (home: StoryHome) => join(home, "approvals");
export const storyApprovalPath = (home: StoryHome, id: string) => join(approvalsDir(home), `${id}.yaml`);

/** The error when a story has no state. */
export const noEntry = (_home: StoryHome, id: string) => `${id} has no entry in state.yaml`;

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

/** Every story's state in the map's state.yaml. */
export function loadStates(home: StoryHome): Record<string, StoryState> {
  const path = statePath(home);
  return { ...((store().exists(path) ? parse(read(path))?.stories : undefined) ?? {}) };
}

export const storyState = (home: StoryHome, id: string): StoryState | undefined => loadStates(home)[id];

/**
 * Change one story's entry. fn gets a yaml Document and the path to the entry in it, so it can
 * setIn and deleteIn and keep comments and order.
 */
export function updateStory(home: StoryHome, id: string, fn: (doc: Document, at: string[]) => void, opts: { create?: boolean } = {}): void {
  // A map with no state.yaml yet starts an empty one: its first story's state creates it.
  const path = statePath(home);
  const doc = parseDocument(store().exists(path) ? read(path) : NEW_STATE);
  if (!doc.getIn(["stories", id]) && !opts.create) throw new Error(noEntry(home, id));
  fn(doc, ["stories", id]);
  store().write(path, yamlOut(doc));
}

/** Add a new story's entry to the map's state.yaml. */
export function createStoryState(home: StoryHome, id: string, entry: StoryState): void {
  updateStory(home, id, (doc, at) => doc.setIn(at, doc.createNode(entry)), { create: true });
}

const NEW_STATE = `format_version: 1
stories: {}
`;

/** Every approval: the map's approvals/<ID>.yaml files. */
export function loadApprovalEntries<T>(home: StoryHome): Record<string, T> {
  const out: Record<string, T> = {};
  for (const f of storyFiles(approvalsDir(home))) {
    const entry = parse(read(f.path));
    if (entry && typeof entry === "object") out[f.id] = entry;
  }
  return out;
}

/** Where a story's approval is recorded: approvals/<ID>.yaml in its map. */
export function approvalFileOf(home: StoryHome, id: string): string {
  return storyApprovalPath(home, id);
}

/** Record a story's approval in its own file. */
export function writeApproval(home: StoryHome, id: string, approval: object): string {
  const path = storyApprovalPath(home, id);
  store().write(path, stringify(approval));
  return path;
}
