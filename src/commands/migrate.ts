// `nikos migrate per-story`: move every story's state and approval to its own file, so people
// and agents working on different stories in parallel branches never edit the same file.
// intent/state.yaml keeps format_version and the run queue; each story gets intent/state/<ID>.yaml
// and, once approved, intent/approvals/<ID>.yaml. `nikos migrate single-file` moves them back.
// Both layouts read and write the same through lib/state-files.ts.
import { dirname, join } from "node:path";
import { parse, parseDocument, stringify } from "yaml";
import { count, findIntentDir, read } from "../lib/project.js";
import { approvalsDir, approvalsFile, stateDir, statePath, storyApprovalPath, storyFiles, storyStatePath } from "../lib/state-files.js";
import { store } from "../lib/store.js";
import { validate } from "./validate.js";

export type Layout = "per-story" | "single-file";

export interface MigrateResult {
  layout: Layout;
  states: number;
  approvals: number;
  /** The CODEOWNERS file, when a rule for approvals was carried over to the new layout. */
  codeowners?: string;
}

const CODEOWNERS = ["CODEOWNERS", ".github/CODEOWNERS", ".gitlab/CODEOWNERS", "docs/CODEOWNERS"];

/** Give a CODEOWNERS rule on approvals.yaml a matching rule on approvals/, or the other way round. */
function carryCodeowners(root: string, to: Layout): string | undefined {
  const file = CODEOWNERS.map((f) => join(root, f)).find((f) => store().exists(f));
  if (!file) return undefined;
  const text = read(file);
  const [from, into] = to === "per-story" ? [/^(\S*intent\/)approvals\.yaml(\s+.+)$/m, "approvals/"] : [/^(\S*intent\/)approvals\/(\s+.+)$/m, "approvals.yaml"];
  const m = text.match(from);
  if (!m) return undefined;
  const line = `${m[1]}${into}${m[2]}`;
  if (text.split("\n").includes(line)) return undefined;
  store().write(file, `${text}${text.endsWith("\n") ? "" : "\n"}${line}\n`);
  return file;
}

export function migrate(dir: string, to: Layout): MigrateResult {
  const intent = findIntentDir(dir);
  if (!store().exists(statePath(intent))) throw new Error("No intent/state.yaml here: set nikOS up first (nikos init)");
  const before = validate(intent);
  if (before.errors.length) throw new Error(`Fix intent/ first (nikos validate lists ${before.errors.length} ${before.errors.length === 1 ? "problem" : "problems"}), so nothing is lost moving it`);
  const doc = parseDocument(read(statePath(intent)));
  let states = 0;
  let approvals = 0;
  if (to === "per-story") {
    const stories: Record<string, unknown> = doc.toJS()?.stories ?? {};
    for (const [id, entry] of Object.entries(stories)) {
      store().write(storyStatePath(intent, id), stringify(entry));
      states++;
    }
    doc.set("stories", doc.createNode({}));
    doc.commentBefore = `${doc.commentBefore ? `${doc.commentBefore}\n` : ""} Each story's state is in intent/state/<ID>.yaml.`;
    store().write(statePath(intent), doc.toString({ flowCollectionPadding: false }));
    if (store().exists(approvalsFile(intent))) {
      for (const [id, a] of Object.entries(parse(read(approvalsFile(intent)))?.approvals ?? {})) {
        store().write(storyApprovalPath(intent, id), stringify(a));
        approvals++;
      }
      store().remove(approvalsFile(intent));
    }
  } else {
    for (const f of storyFiles(stateDir(intent))) {
      doc.setIn(["stories", f.id], doc.createNode(parse(read(f.path))));
      store().remove(f.path);
      states++;
    }
    if (doc.commentBefore) doc.commentBefore = doc.commentBefore.replace(/\n? Each story's state is in intent\/state\/<ID>\.yaml\./, "") || null;
    store().write(statePath(intent), doc.toString({ flowCollectionPadding: false }));
    const files = storyFiles(approvalsDir(intent));
    if (files.length) {
      const path = approvalsFile(intent);
      const adoc = parseDocument(store().exists(path) ? read(path) : "# Sign-offs on done stories, written by nikos approve.\nformat_version: 1\napprovals: {}\n");
      for (const f of files) {
        adoc.setIn(["approvals", f.id], adoc.createNode(parse(read(f.path))));
        store().remove(f.path);
        approvals++;
      }
      store().write(path, adoc.toString({ flowCollectionPadding: false }));
    }
  }
  const after = validate(intent);
  if (after.errors.length) throw new Error(`The move left problems in intent/; check it with nikos validate:\n${after.errors.map((e) => `  ${e.file}: ${e.message}`).join("\n")}`);
  const codeowners = carryCodeowners(dirname(intent), to);
  return { layout: to, states, approvals, ...(codeowners ? { codeowners } : {}) };
}

export function runMigrate(args: string[]): number {
  const i = args.indexOf("--dir");
  const dir = i >= 0 ? args[i + 1] : process.cwd();
  const to = args.find((a, n) => !a.startsWith("--") && (i < 0 || n !== i + 1));
  if (to !== "per-story" && to !== "single-file") {
    console.error("Usage: nikos migrate per-story | single-file [--dir <path>]\n  per-story    each story's state and approval in its own file, so parallel branches don't conflict\n  single-file  back to intent/state.yaml and intent/approvals.yaml");
    return 1;
  }
  try {
    const r = migrate(dir, to);
    console.log(
      r.layout === "per-story"
        ? `Moved ${count(r.states, "story", "stories")} to intent/state/<ID>.yaml${r.approvals ? ` and ${count(r.approvals, "approval")} to intent/approvals/<ID>.yaml` : ""}.`
        : `Moved ${count(r.states, "story", "stories")} back to intent/state.yaml${r.approvals ? ` and ${count(r.approvals, "approval")} to intent/approvals.yaml` : ""}.`,
    );
    if (r.codeowners) console.log(`Added a matching approvals rule to ${r.codeowners}.`);
    console.log("Commit the change in one go, on a branch nobody else is moving stories on.");
    return 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
