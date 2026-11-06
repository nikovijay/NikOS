// `nikos join` and `nikos settings`: link this repo to the plan above it, and see or change the
// settings it inherits. Joining is one line in planning/upstream.yaml plus a sync; nothing in
// the repo moves, so a team that started on its own keeps everything it has.
import { join } from "node:path";
import { parseDocument } from "yaml";
import { REPO_PATH } from "../lib/bets.js";
import { formatSettings, resolveSettings, setSetting, type Resolved } from "../lib/settings.js";
import { store } from "../lib/store.js";
import { sync, upstreamEntries, type SyncReport } from "../planning/upstream.js";

export interface JoinResult {
  repo: string;
  added: boolean;
  sync: SyncReport;
  settings: Resolved;
}

/** Add an upstream plan to planning/upstream.yaml (if it isn't there), sync, and resolve the settings. */
export function joinPlan(root: string, input: { repo: string; host?: string; url?: string; ref?: string }): JoinResult {
  if (!REPO_PATH.test(input.repo)) throw new Error(`'${input.repo}' is not a repo path (owner/repo, or group/subgroup/project on GitLab)`);
  const path = join(root, "planning", "upstream.yaml");
  const added = !upstreamEntries(root).some((e) => e.repo === input.repo);
  if (added) {
    const before = store().exists(path) ? store().read(path) : undefined;
    const doc = parseDocument(before ?? "# Plans in other repos this one works toward. nikos planning sync reads them.\n[]\n");
    const entry = { repo: input.repo, ...(input.ref ? { ref: input.ref } : {}), ...(input.host ? { host: input.host } : {}), ...(input.url ? { url: input.url } : {}) };
    if (!doc.contents || !("items" in (doc.contents as any))) doc.contents = doc.createNode([]) as any;
    (doc.contents as any).flow = false;
    (doc.contents as any).items.push(doc.createNode(entry));
    store().write(path, doc.toString({ lineWidth: 0 }));
    try {
      upstreamEntries(root); // a bad host or url fails here, before anything is fetched
    } catch (err) {
      store().write(path, before ?? "[]\n");
      throw err;
    }
  }
  const report = sync(root);
  return { repo: input.repo, added, sync: report, settings: resolveSettings(root) };
}

export function runJoin(args: string[]): number {
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const repo = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  if (!repo) {
    console.error("Usage: nikos join <owner/repo | group/subgroup/project> [--host gitlab.com] [--url <git url>] [--ref <branch>] [--dir <path>]");
    return 1;
  }
  try {
    const r = joinPlan(flag("dir") ?? process.cwd(), { repo, host: flag("host"), url: flag("url"), ref: flag("ref") });
    console.log(r.added ? `Joined ${r.repo}: added to planning/upstream.yaml` : `Already joined to ${r.repo}`);
    for (const s of r.sync.synced) console.log(`  ✓ ${s.repo} at ${s.commit.slice(0, 7)}${s.via ? ` (above ${s.via})` : ""}`);
    for (const u of r.sync.unresolved) console.log(`  ? ${u.repo}: ${u.reason}`);
    console.log(`\nSettings here now:\n${formatSettings(r.settings)}`);
    return r.sync.unresolved.some((u) => u.repo === r.repo) ? 1 : 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}

/** Read a value given on the command line: JSON when it parses (true, ["app","chat"]), else text; a, b, c is a list. */
const valueOf = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.includes(",") ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw;
  }
};

export function runSettings(args: string[]): number {
  const i = args.indexOf("--dir");
  const root = i >= 0 ? args[i + 1] : process.cwd();
  const [sub = "show", key, raw] = args.filter((a, n) => a !== "--dir" && (i < 0 || n !== i + 1));
  try {
    if (sub === "show") {
      console.log(formatSettings(resolveSettings(root)));
      return 0;
    }
    if (sub === "set" && key && raw !== undefined) {
      setSetting(root, key, valueOf(raw));
      console.log(`${key}: ${JSON.stringify(resolveSettings(root)[key].value)}  (this repo)`);
      return 0;
    }
    console.error("Usage: nikos settings [show] | nikos settings set <key> <value> [--dir <path>]");
    return 1;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
