// `nikos join` and `nikos settings`: link this repo to the plan above it, and see or change the
// settings it inherits. Joining is one line in planning/upstream.yaml plus a sync; nothing in
// the repo moves, so a repo that started on its own keeps everything it has.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { parse, parseDocument, stringify } from "yaml";
import { REPO_PATH } from "../lib/bets.js";
import { formatSettings, resolveSettings, resolveSettingsDetailed, setSetting, type Resolved } from "../lib/settings.js";
import { store } from "../lib/store.js";
import { keyClash } from "../lib/keys.js";
import { paths } from "../planning/model.js";
import { readLock, sync, upstreamEntries, type SyncReport } from "../planning/upstream.js";

export interface JoinResult {
  repo: string;
  added: boolean;
  /** Whether the plan could be fetched. When it couldn't, it stays listed, for a later sync. */
  fetched: boolean;
  sync: SyncReport;
  settings: Resolved;
}

/** The plan a group is homed in, or the one it'd need to be: the entry marked home: true in its planning/upstream.yaml. */
function homeIn(path: string): string | undefined {
  if (!store().exists(path)) return undefined;
  const list = parseDocument(store().read(path)).toJSON();
  const home = Array.isArray(list) ? list.find((e: any) => e?.home === true) : undefined;
  return typeof home?.repo === "string" ? home.repo : undefined;
}

/**
 * Add an upstream plan to planning/upstream.yaml (if it isn't there), sync, and resolve the settings.
 * home: this plan is the repo's home, marked in planning/upstream.yaml.
 */
export function joinPlan(root: string, input: { repo: string; host?: string; url?: string; ref?: string; home?: boolean }): JoinResult {
  if (!REPO_PATH.test(input.repo)) throw new Error(`'${input.repo}' is not a repo path (owner/repo, or group/subgroup/project on GitLab)`);
  const path = join(root, "planning", "upstream.yaml");
  if (input.home) {
    const other = homeIn(path);
    if (other && other !== input.repo) throw new Error(`${other} is already this plan's home: a group has one home`);
  }
  const before = store().exists(path) ? store().read(path) : undefined;
  const added = !upstreamEntries(root).some((e) => e.repo === input.repo);
  if (added) {
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
  // The home is marked on the plan's entry in planning/upstream.yaml.
  if (input.home) {
    const doc = parseDocument(store().read(path));
    const item = (doc.contents as any).items.find((it: any) => it?.toJSON?.()?.repo === input.repo);
    if (item) item.set("home", true);
    store().write(path, doc.toString({ lineWidth: 0 }));
  }
  const copy = join(paths(root).cache, ...input.repo.split("/"));
  const undo = () => {
    if (before === undefined) store().remove(path);
    else store().write(path, before);
    // A plan this call didn't add keeps its copy and its lock: only what this call made is taken back.
    if (!added) return;
    rmSync(copy, { recursive: true, force: true });
    const lock = readLock(root).filter((l) => l.repo !== input.repo);
    store().write(paths(root).lock, `# Written by nikos planning sync: the commit each plan's copy was read at.\n${stringify(lock)}`);
  };
  const report = sync(root);
  const fetched = !report.unresolved.some((u) => u.repo === input.repo);
  // Its key must be its own across the chain: this repo's, and the copies already here (amendment D5).
  const fetchedKey = fetched && store().exists(join(copy, "planning", "plan.yaml")) ? parse(store().read(join(copy, "planning", "plan.yaml")))?.key : undefined;
  const copies = [paths(root).cache];
  const clash = typeof fetchedKey === "string" ? keyClash(root, input.repo, fetchedKey, copies) : undefined;
  if (clash) {
    undo();
    throw new Error(clash);
  }
  return { repo: input.repo, added, fetched, sync: report, settings: resolveSettings(root) };
}

/** What joining did, in words: for the command line and the MCP tool alike. */
export function describeJoin(r: JoinResult): string {
  const why = r.sync.unresolved.find((u) => u.repo === r.repo)?.reason;
  if (!r.fetched) {
    return [
      `✗ Couldn't fetch ${r.repo}: ${why}`,
      `  It's ${r.added ? "now" : "still"} listed in planning/upstream.yaml, but nothing comes from it until it can be fetched.`,
      "  Check the repo path is right and that you can clone it. Then run: nikos planning sync",
      "  To stop following it, delete its entry from planning/upstream.yaml.",
    ].join("\n");
  }
  const lines = [r.added ? `✓ Joined ${r.repo}. It's listed in planning/upstream.yaml.` : `This repo already follows ${r.repo}.`];
  lines.push("Fetched a read-only copy of:");
  for (const s of r.sync.synced) lines.push(`  ✓ ${s.repo} at ${s.commit.slice(0, 7)}${s.via ? ` (the plan above ${s.via})` : ""}`);
  for (const u of r.sync.unresolved) lines.push(`  ? ${u.repo}: ${u.reason}`);
  lines.push("", "The settings that now apply here:", formatSettings(r.settings), "", "Nothing in this repo moved.");
  return lines.join("\n");
}

export function runJoin(args: string[]): number {
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // --home is a switch, so the repo may come straight after it.
  const repo = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--home"));
  if (!repo) {
    console.error("✗ Which plan should this repo join? Give its repo path. For example: nikos join acme/company-plan\n\nUsage: nikos join <owner/repo | group/subgroup/project> [--home] [--host gitlab.com] [--url <git url>] [--ref <branch>] [--dir <path>]");
    return 1;
  }
  try {
    const r = joinPlan(flag("dir") ?? process.cwd(), { repo, host: flag("host"), url: flag("url"), ref: flag("ref"), home: args.includes("--home") });
    (r.fetched ? console.log : console.error)(describeJoin(r));
    return r.fetched ? 0 : 1;
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
      const r = resolveSettingsDetailed(root);
      console.log(formatSettings(r.resolved));
      for (const p of r.problems) console.log(`! ${p}`);
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
