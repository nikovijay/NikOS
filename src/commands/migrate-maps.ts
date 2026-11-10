// `nikos migrate maps`: a 0.2.x repo's intent/ story map moves to maps/<key>/. It is a move plus a
// conversion: state/<ID>.yaml folds into state.yaml, approvals.yaml splits into one file per approval,
// and the constitution and decisions go to the repo root. A story id takes the key in
// planning/plan.yaml when the plan has one. Nothing moves until the plan is shown and confirmed. The
// new layout is checked on a copy of the repo first, so a failed check writes nothing. The changes
// are left uncommitted on nikos/migrate-maps, or committed with --commit. Nothing is pushed.
// If the repo changes and then fails (a write, or the check), the repo is put back as it was.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { isMap, isSeq, parse, parseDocument, stringify } from "yaml";
import { BET_ID, CROSS_REF } from "../lib/bets.js";
import { betText, checkBet, paths as planPaths } from "../planning/model.js";
import { store } from "../lib/store.js";
import { count, read, walk } from "../lib/project.js";
import { mapDirs } from "../lib/maps.js";
import { writeMapSummary } from "../lib/map-summary.js";
import { branchExists, commitPaths, currentBranch, gitIn, isGit, pathOf, statusOf, switchNewBranch } from "../lib/git.js";
import { codeownersFile, moveCodeowners } from "../lib/codeowners.js";
import { rewriteRunnerPaths } from "../lib/runner-paths.js";
import { newIdFor, renameDecisionHeadings, renameIds, retagFeature, type IdTable } from "../lib/id-rename.js";
import { type Ask } from "./onboard.js";
import { interactive } from "./start.js";
import { KEY } from "../lib/keys.js";
import { validateMap } from "./validate.js";

const MIGRATE_BRANCH = "nikos/migrate-maps";
const commitMessage = (folder: string) => `Migrate intent/ to maps/${folder}/ (nikos migrate maps)`;
/** What intent/ may hold. Each of these moves or folds into the map; anything else stops the migration. */
const MOVED = ["storymap.yaml", "features", "state.yaml", "state", "approvals.yaml", "approvals", "plans", "constitution.md", "decisions.md"];
/** Files migrate removes rather than moves: a placeholder, or a Finder or Explorer file that isn't part of the map. */
const JUNK = [".DS_Store", "Thumbs.db"];
const KNOWN = [...MOVED, ".gitkeep", ...JUNK];
const RUNNERS = ["cucumber.mjs", "cucumber.js", "behave.ini"];
/** Files that sit at the repo root once migrated, one of each for the repo. */
const ROOT_FILES = ["constitution.md", "decisions.md"];
/** A state.yaml with no stories, for a map that has none yet. */
const NEW_STATE = "format_version: 1\nstories: {}\n";

/** A refusal (exit 1) or a usage error (exit 2). The message is shown as it is. */
export class MigrateError extends Error {
  constructor(
    message: string,
    readonly code: 1 | 2 = 1,
  ) {
    super(message);
  }
}

export interface MapsOptions {
  key?: string;
  /** --new-bet: the bet the map specs, with a stub card when planning/ has none. */
  newBet?: string;
  commit?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  noBranch?: boolean;
  branchName?: string;
}

export interface Answers {
  key: string;
  /** The bet the map specs, named in bet:. Undefined: the map names none, and the links to bets are listed as dropped. */
  bet?: string;
  /** Write a stub card for bet, since planning/bets/ has none. */
  stub: boolean;
}

export interface MapsPlan {
  root: string;
  key: string;
  folder: string;
  /** The plan's key, which story ids take as their prefix (KEY-n becomes PLAN-KEY-n). Undefined when the plan names none. */
  prefix?: string;
  /** The bet the map names in bet:, if any. */
  bet?: string;
  /** Whether the releases or stories named bets at all (their lines are dropped from the file). */
  hadBets: boolean;
  /** Files moved from intent/ to a new path, repo-relative. Each one's text is in files. */
  moves: { from: string; to: string }[];
  /** Files folded into another: a story's state into state.yaml, approvals.yaml into one file per approval. Removed after the write. */
  folds: { from: string; into: string }[];
  /** Files under intent/ that are removed, not moved: placeholders and Finder or Explorer files. */
  removes: string[];
  /** Every file the migration writes, moved or new or changed, with the text it ends with. */
  files: Map<string, string>;
  /** Paths the migration creates (not moved, not rewritten). */
  creates: string[];
  /** Renamed story ids, old and new. */
  renames: [string, string][];
  edits: number;
  editedFiles: number;
  /** Bet links that were dropped, and the links the person re-adds by hand. */
  dropped: string[];
  /** What the migration did not change, for the person to check by hand. */
  notChanged: string[];
  runner: string[];
  codeowners: string[];
}

/** A yaml file as an object, or undefined when it doesn't parse. */
const yamlOf = (path: string): any => {
  try {
    return parse(read(path));
  } catch {
    return undefined;
  }
};

/** Rename ids on each line except ticket values, which are external keys and are never renamed. */
function renameLines(textIn: string, table: IdTable): { text: string; count: number } {
  let n = 0;
  const out = textIn.split("\n").map((line) => {
    if (/^\s*ticket:/.test(line)) return line;
    const r = renameIds(line, table);
    n += r.count;
    return r.text;
  });
  return { text: out.join("\n"), count: n };
}

/** The ticket values in state files: kept as they are. */
function ticketsIn(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/^\s*ticket:\s*(\S+)/gm)) out.add(m[1].replace(/^["']|["']$/g, ""));
  return [...out];
}

/** Every bet a release or a story names, with where it's named. */
function betRefs(storymap: any): { where: string; ref: string }[] {
  const refs: { where: string; ref: string }[] = [];
  for (const r of storymap?.releases ?? []) for (const ref of Array.isArray(r?.bets) ? r.bets : []) refs.push({ where: `release ${r.number} names`, ref: String(ref) });
  for (const [id, list] of Object.entries(storymap?.story_bets ?? {})) for (const ref of Array.isArray(list) ? list : [list]) refs.push({ where: `story ${id} names`, ref: String(ref) });
  return refs;
}

/** The local bet ids the releases name, in the order they appear, each once. */
const namedBets = (storymap: any): string[] => [...new Set(betRefs(storymap).map((b) => b.ref).filter((r) => BET_ID.test(r)))];

/** The plan's key, which story ids take as their prefix. Undefined when planning/plan.yaml names none. */
const planKeyOf = (root: string): string | undefined => {
  const key = yamlOf(join(root, "planning", "plan.yaml"))?.key;
  return typeof key === "string" ? key : undefined;
};

/**
 * The story ids in the releases that take the plan's key: KEY-n becomes PREFIX-KEY-n. An id that already
 * starts with the prefix keeps it. An id that isn't KEY-n can't be renamed, so it is reported as stray.
 */
function idTable(storymap: any, prefix: string, key: string): { table: IdTable; stray: string[] } {
  const table: IdTable = new Map();
  const stray: string[] = [];
  for (const r of storymap.releases ?? []) {
    for (const id of Array.isArray(r?.stories) ? r.stories : []) {
      if (String(id).startsWith(`${prefix}-`)) continue;
      const next = newIdFor(id, storymap.key, prefix, key);
      if (!next) stray.push(id);
      else table.set(id, next);
    }
  }
  return { table, stray };
}

/** Whether a file under intent/ (by its path there) is one a move picks up. State and approvals are one file per story, flat. */
const isMoved = (rel: string) => {
  const flat = (dir: string) => rel.startsWith(`${dir}/`) && rel.endsWith(".yaml") && !rel.slice(dir.length + 1).includes("/");
  return (
    ["storymap.yaml", "state.yaml", "approvals.yaml", "constitution.md", "decisions.md"].includes(rel) ||
    (rel.startsWith("features/") && rel.endsWith(".feature")) ||
    flat("state") ||
    flat("approvals") ||
    (rel.startsWith("plans/") && rel.endsWith(".md"))
  );
};

const isJunk = (rel: string) => basename(rel) === ".gitkeep" || JUNK.includes(basename(rel));

/** The .yaml files directly in a folder, by name. A folder that isn't there is empty. */
const yamlNames = (dir: string): string[] => (store().isDir(dir) ? store().list(dir) : []).filter((f) => f.endsWith(".yaml")).sort();

/** Every file and folder under a folder of the repo, as repo-relative paths. A folder that isn't there is empty. */
function entriesUnder(root: string, rel: string): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  const walkDir = (path: string, at: string) => {
    for (const e of readdirSync(path, { withFileTypes: true })) {
      const r = `${at}/${e.name}`;
      if (e.isDirectory()) {
        dirs.push(r);
        walkDir(join(path, e.name), r);
      } else files.push(r);
    }
  };
  if (existsSync(join(root, rel))) walkDir(join(root, rel), rel);
  return { files, dirs };
}

/** What migrate does with each file under intent/: moved, removed, or stray (the migration stops for it). */
function sortIntent(root: string): { removes: string[]; stray: string[] } {
  const removes: string[] = [];
  const stray: string[] = [];
  for (const f of entriesUnder(root, "intent").files) {
    const rel = f.slice("intent/".length);
    if (isMoved(rel)) continue;
    if (isJunk(rel)) removes.push(f);
    else stray.push(f);
  }
  return { removes, stray };
}

/** Refusals that need no answer: the repo's shape, its git state, its intent/ folder, and the root files it would overwrite. */
function preflight(root: string, git: boolean, opts: MapsOptions): void {
  const intent = join(root, "intent");
  if (store().isDir(join(root, "maps")) || mapDirs(root).length) throw new MigrateError("This repo already has maps/. Migrate needs a repo with intent/ and no maps/.");
  if (!store().exists(join(intent, "storymap.yaml"))) throw new MigrateError("Nothing to migrate: there is no intent/storymap.yaml here.");
  if (git) {
    const dirty = statusOf(root, undefined).map(pathOf);
    if (dirty.length) throw new MigrateError(`Uncommitted changes in: ${dirty.slice(0, 5).join(", ")}. Commit or stash them first, so the migration is the only change.`);
    const branch = opts.branchName ?? MIGRATE_BRANCH;
    if (!opts.noBranch && branchExists(root, branch)) throw new MigrateError(`Branch ${branch} already exists. Delete it, or pass --branch-name <name>.`);
  }
  for (const f of store().list(intent)) {
    if (!KNOWN.includes(f)) throw new MigrateError(`intent/ has ${f}, which migrate does not move. Move or remove it first.`);
  }
  // A file the moves don't pick up would be lost with intent/, so it stops the migration here, before any write.
  const stray = sortIntent(root).stray;
  if (stray.length) throw new MigrateError(`${stray[0]} isn't a story file, so migrate doesn't move it. Move or remove it first.`);
  // The constitution and the decisions go to the root. A file already there that differs is not merged.
  for (const f of ROOT_FILES) {
    const here = join(root, f);
    const there = join(intent, f);
    if (store().exists(here) && store().exists(there) && read(here) !== read(there)) {
      throw new MigrateError(`${f} at the repo root and intent/${f} both exist, and they differ. Merge them by hand, then retry.`);
    }
  }
}

/** A stub bet card, for --new-bet. The person fills in its hypothesis by hand. */
function stubBetText(id: string, owner: string): string {
  const meta = {
    id,
    owner,
    hypothesis: "Write what we believe this bet changes, and how we'll know.",
    krs: { also: [] },
    review_on: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    confidence: "medium",
    dependencies: [],
    outcome: "open",
    reviews: [],
  };
  if (!checkBet(meta)) throw new MigrateError(`Not a valid bet card: ${id}`);
  return betText(meta, "\n## Why we think so\nThe evidence behind the hypothesis: what we saw, and where.\n");
}

/** The plan for the answers. Throws a refusal for anything it can't migrate. Reads the repo; writes nothing. */
export function planMapsMigration(root: string, a: Answers): MapsPlan {
  const intent = join(root, "intent");
  const folder = a.key.toLowerCase();
  const target = `maps/${folder}`;
  const storyText = read(join(intent, "storymap.yaml"));
  const storymap: any = parse(storyText);
  const prefix = planKeyOf(root);
  const table: IdTable = new Map();
  if (prefix) {
    const found = idTable(storymap, prefix, a.key);
    if (found.stray.length) throw new MigrateError(`Story ${found.stray.join(", ")} doesn't start with ${storymap.key}-, so it can't take the plan's key ${prefix}. Rename it by hand, then retry.`);
    for (const [from, to] of found.table) table.set(from, to);
  }
  const renames = [...table.entries()];

  const files = new Map<string, string>();
  const moves: MapsPlan["moves"] = [];
  const folds: MapsPlan["folds"] = [];
  const creates: string[] = [];
  const edited = new Map<string, number>();
  let edits = 0;
  const place = (from: string, to: string, body: string, n = 0) => {
    moves.push({ from, to });
    files.set(to, body);
    if (n) {
      edits += n;
      edited.set(to, n);
    }
  };
  /** A path under a folder of intent/, with slashes, as the move records it. */
  const under = (dir: string, f: string) => relative(dir, f).split(sep).join("/");

  // storymap.yaml: ids renamed, key set to the map's, bet: added when the map names one; bets: and story_bets: dropped.
  const bet = a.bet;
  const dropped: string[] = [];
  for (const { where, ref } of betRefs(storymap)) {
    if (bet && ref === bet) continue; // the map's bet, named in bet: now
    if (CROSS_REF.test(ref)) dropped.push(`${where} ${ref}: a bet in another repo can't be named here, so it's dropped`);
    else dropped.push(`${where} ${ref}: a map names one bet, in bet:, so this link is dropped: name it by hand once its card is in planning/bets/`);
  }
  const renamed = renameIds(storyText, table);
  const withKey = renamed.text.replace(/^key:.*$/m, (line) => `${line.replace(/^key:.*$/, `key: ${a.key}`)}${bet ? `\nbet: ${bet}` : ""}`);
  const doc = parseDocument(withKey);
  doc.delete("story_bets");
  const releases = doc.get("releases");
  if (isSeq(releases)) for (const item of releases.items) if (isMap(item)) item.delete("bets");
  place("intent/storymap.yaml", `${target}/storymap.yaml`, doc.toString({ flowCollectionPadding: false }), renamed.count);

  // Features: the tags above Feature: only. The spec hash covers the rest, so approvals hold.
  for (const path of walk(join(intent, "features"), ".feature")) {
    const rel = under(intent, path);
    const r = retagFeature(read(path), table);
    place(`intent/${rel}`, `${target}/${rel}`, r.text, r.count);
  }

  // State: state.yaml's stories, with each state/<ID>.yaml folded in under its id. Ticket values stay.
  const stateTo = `${target}/state.yaml`;
  const stateIn = join(intent, "state.yaml");
  const stateBase = renameLines(store().exists(stateIn) ? read(stateIn) : NEW_STATE, table);
  const stateDoc = parseDocument(stateBase.text);
  const haveStory = new Set<string>(Object.keys(stateDoc.toJS()?.stories ?? {}));
  for (const f of yamlNames(join(intent, "state"))) {
    const id0 = f.slice(0, -".yaml".length);
    const id = table.get(id0) ?? id0;
    if (haveStory.has(id)) throw new MigrateError(`${id} is in both state.yaml and state/${f}: keep one, then retry.`);
    haveStory.add(id);
    stateDoc.setIn(["stories", id], stateDoc.createNode(parse(read(join(intent, "state", f)))));
    folds.push({ from: `intent/state/${f}`, into: stateTo });
  }
  const stateOut = stateDoc.toString({ flowCollectionPadding: false });
  if (store().exists(stateIn)) place("intent/state.yaml", stateTo, stateOut, stateBase.count);
  else {
    files.set(stateTo, stateOut);
    creates.push(stateTo);
  }

  // Approvals: approvals.yaml splits into one file per approval. approvals/<ID>.yaml moves as it is.
  const split = new Map<string, string>();
  if (store().exists(join(intent, "approvals.yaml"))) {
    const entries: Record<string, unknown> = parse(read(join(intent, "approvals.yaml")))?.approvals ?? {};
    for (const [id0, entry] of Object.entries(entries)) split.set(table.get(id0) ?? id0, stringify(entry));
    folds.push({ from: "intent/approvals.yaml", into: `${target}/approvals/` });
  }
  for (const f of yamlNames(join(intent, "approvals"))) {
    const id0 = f.slice(0, -".yaml".length);
    const id = table.get(id0) ?? id0;
    if (split.has(id)) throw new MigrateError(`${id} is in both approvals.yaml and approvals/${f}: keep one, then retry.`);
    place(`intent/approvals/${f}`, `${target}/approvals/${id}.yaml`, read(join(intent, "approvals", f)), id0 === id ? 0 : 1);
  }
  for (const [id, text] of split) {
    const to = `${target}/approvals/${id}.yaml`;
    files.set(to, text);
    creates.push(to);
  }

  // Plans: their names and bodies. Plans aren't hashed, so their text can change.
  for (const f of walk(join(intent, "plans"), ".md")) {
    const rel = under(join(intent, "plans"), f);
    const body = renameIds(read(f), table);
    const name = renameIds(rel, table);
    place(`intent/plans/${rel}`, `${target}/plans/${name.text}`, body.text, body.count + name.count);
  }

  // The constitution and the decisions sit at the repo root.
  if (store().exists(join(intent, "constitution.md"))) place("intent/constitution.md", "constitution.md", read(join(intent, "constitution.md")));
  if (store().exists(join(intent, "decisions.md"))) {
    const d = renameDecisionHeadings(read(join(intent, "decisions.md")), table);
    place("intent/decisions.md", "decisions.md", d.text, d.count);
  }

  // The stub bet, when asked: it needs a planning/ folder to live in.
  const planning = store().isDir(join(root, "planning"));
  if (a.stub) {
    if (!bet) throw new MigrateError("--new-bet needs a bet id", 2);
    if (!planning) throw new MigrateError("--new-bet needs a planning/ folder: the bet card goes in planning/bets/. There is no planning/ here.", 2);
    files.set(`planning/bets/${bet}.md`, stubBetText(bet, basename(root)));
    creates.push(`planning/bets/${bet}.md`);
  }

  // Runner config, CODEOWNERS and .gitignore: rewritten only when the line is one of the known forms.
  const notChanged: string[] = [];
  const runner: string[] = [];
  for (const file of RUNNERS) {
    if (!store().exists(join(root, file))) continue;
    const r = rewriteRunnerPaths(file, read(join(root, file)), folder);
    if (r.text !== undefined) {
      files.set(file, r.text);
      runner.push(file);
    }
    if (r.hint) notChanged.push(r.hint);
  }
  const codeowners: string[] = [];
  const owners = codeownersFile(root);
  if (owners) {
    const before = read(owners);
    const r = moveCodeowners(before, folder);
    if (r.changed.length) {
      const rel = relative(root, owners).split(sep).join("/");
      files.set(rel, r.text);
      for (const line of before.split("\n")) {
        if (!/^\/?intent\//.test(line)) continue;
        const from = line.trim().split(/\s+/)[0];
        codeowners.push(`${rel}: ${from} -> ${from.replace(/^(\/?)intent\//, `$1${target}/`)}`);
      }
    }
  }
  const ignore = join(root, ".gitignore");
  if (store().exists(ignore)) {
    const lines = read(ignore).split("\n");
    const rewritten = lines.map((l) => {
      const m = l.trim().match(/^(\/?)intent\/(.*)$/);
      if (!m) return l;
      return MOVED.includes(m[2].split("/")[0]) ? l.replace(/(\/?)intent\//, `$1${target}/`) : l;
    });
    for (const l of lines) {
      const m = l.trim().match(/^(\/?)intent\/(.*)$/);
      if (m && !MOVED.includes(m[2].split("/")[0])) notChanged.push(`.gitignore: ${l.trim()} isn't a moved file, so it's not changed: add its new path by hand`);
    }
    if (rewritten.join("\n") !== lines.join("\n")) files.set(".gitignore", rewritten.join("\n"));
  }
  if (renames.length) {
    const kept = ticketsIn([stateBase.text, ...yamlNames(join(intent, "state")).map((f) => read(join(intent, "state", f)))]);
    if (kept.length) notChanged.push(`ticket values kept: ${kept.join(", ")}`);
    notChanged.push(...otherMentions(root, renames.map(([old]) => old)));
  }

  // Two moves onto one path would overwrite each other: refused, not written.
  const dest = new Set<string>();
  for (const m of moves) {
    if (dest.has(m.to)) throw new MigrateError(`Two files would both move to ${m.to}. Rename one by hand, then retry.`);
    dest.add(m.to);
  }
  return {
    root,
    key: a.key,
    folder,
    ...(prefix ? { prefix } : {}),
    ...(bet ? { bet } : {}),
    hadBets: betRefs(storymap).length > 0,
    moves,
    folds,
    removes: sortIntent(root).removes,
    files,
    creates,
    renames,
    edits,
    editedFiles: edited.size,
    dropped,
    notChanged,
    runner,
    codeowners,
  };
}

/** Files outside intent/ that name a renamed id, from git grep, at most 20 files. Checked before the move. */
function otherMentions(root: string, olds: string[]): string[] {
  if (!olds.length || !isGit(root)) return [];
  const out: string[] = [];
  let shown = 0;
  for (const id of olds) {
    if (shown >= 20) break;
    const r = gitIn(root, ["grep", "-l", "-w", "-F", "-e", id, "--", ".", ":(exclude)intent"]);
    const files = r.stdout.split("\n").filter(Boolean).slice(0, 20 - shown);
    if (files.length) {
      shown += files.length;
      out.push(`other files mentioning ${id}: ${files.join(", ")} (not changed)`);
    }
  }
  return out;
}

/** What the checks say about each map the migration wrote: each map validates on its own. A check that throws is a problem too. */
function mapErrors(root: string): string[] {
  const out: string[] = [];
  for (const dir of mapDirs(root)) {
    const id = basename(dir);
    try {
      for (const e of validateMap({ root, dir, id, inRepo: true }).errors) out.push(`maps/${id}/${e.file}: ${e.message}`);
    } catch (err) {
      out.push(`maps/${id}: ${(err as Error).message}`);
    }
  }
  return out;
}

/** The temp-tree check: the new layout, built in a copy of planning/, intent/ and the upstream cache, must pass validate. */
export function targetProblems(root: string, plan: MapsPlan): string[] {
  const tmp = mkdtempSync(join(tmpdir(), "nikos-migrate-"));
  try {
    for (const rel of ["planning", "intent", join(".nikos", "upstream")]) {
      if (store().exists(join(root, rel))) cpSync(join(root, rel), join(tmp, rel), { recursive: true });
    }
    // The copy ends as the real apply does: moved and folded files gone from intent/, the rest removed with it.
    for (const m of plan.moves) rmSync(join(tmp, m.from), { force: true });
    for (const f of plan.folds) rmSync(join(tmp, f.from), { force: true });
    rmSync(join(tmp, "intent"), { recursive: true, force: true });
    for (const [rel, body] of plan.files) store().write(join(tmp, rel), body);
    // Each new map's delivery.yaml, as the real apply writes it: a map that can't be summarised is reported by the checks.
    for (const dir of mapDirs(tmp)) {
      try {
        writeMapSummary(tmp, dir);
      } catch {
        // the checks below say what is wrong with the map
      }
    }
    return mapErrors(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The plan as the person reads it: each move, each fold, each removal, the ids, and what to check by hand. */
export function renderPlan(p: MapsPlan, dry: boolean): string[] {
  const out: string[] = [`nikos migrate maps: intent/ -> maps/${p.folder}/${dry ? " (dry run: nothing written)" : ""}`, "", "Moves"];
  const byItem = new Map<string, { n: number; from: string; to: string }>();
  for (const m of p.moves) {
    const item = m.from.split("/")[1];
    const got = byItem.get(item);
    if (got) got.n++;
    else byItem.set(item, { n: 1, from: m.from, to: m.to });
  }
  for (const [item, g] of byItem) {
    const single = g.n === 1 && g.from === `intent/${item}`;
    const from = single ? `intent/${item}` : `intent/${item}/ (${count(g.n, "file")})`;
    const to = single ? g.to : `${g.to.slice(0, g.to.indexOf(item) + item.length)}/`;
    const note = item === "storymap.yaml" ? ` (${[p.bet ? `bet: ${p.bet}` : "no bet", p.hadBets ? "bets: and story_bets: dropped" : ""].filter(Boolean).join("; ")})` : "";
    out.push(`  ${from.padEnd(30)} -> ${to}${note}`);
  }
  for (const f of p.folds) {
    const what = f.from.endsWith("approvals.yaml") ? "one file per approval" : "merged into stories";
    out.push(`  ${f.from.padEnd(30)} -> ${f.into} (${what})`);
  }
  for (const r of p.removes) {
    const why = basename(r) === ".gitkeep" ? "an empty folder's placeholder" : "a Finder or Explorer file, not part of the map";
    out.push(`  ${r.padEnd(30)} removed (${why})`);
  }
  if (p.creates.length) {
    out.push("Creates");
    for (const f of p.creates) out.push(`  ${f.padEnd(30)} ${f.startsWith("planning/bets/") ? "(stub, from --new-bet)" : "(new)"}`);
  }
  if (p.renames.length) {
    out.push(`Ids (the plan's key ${p.prefix}): ${count(p.renames.length, "id")}, ${count(p.edits, "edit")} in ${count(p.editedFiles, "file")}`, `  ${p.renames.map(([o, n]) => `${o} -> ${n}`).join(", ")}`);
  }
  if (p.notChanged.length || p.dropped.length) {
    out.push("Not changed, check by hand");
    for (const d of p.dropped) out.push(`  dropped bet links: ${d}`);
    for (const l of p.notChanged) out.push(`  ${l}`);
  }
  for (const r of p.runner) out.push(`Runner: ${r} paths updated (intent/features -> maps/${p.folder}/features)`);
  for (const c of p.codeowners) out.push(`CODEOWNERS: ${c.slice(c.indexOf(": ") + 2)}`);
  return out;
}

/** Remove the empty folders under a folder, bottom up, and the folder itself when that leaves it empty. */
function removeEmptyDirs(dir: string): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) removeEmptyDirs(join(dir, e.name));
  if (!readdirSync(dir).length) rmdirSync(dir);
}

/** The repo as it was before the migration writes: each file it may touch, with its bytes, and the folders. */
interface Snapshot {
  files: Map<string, Buffer>;
  dirs: string[];
  maps: boolean;
}

function snapshotOf(root: string, p: MapsPlan): Snapshot {
  const files = new Map<string, Buffer>();
  const dirs: string[] = [];
  for (const rel of ["intent", "planning"]) {
    if (existsSync(join(root, rel))) dirs.push(rel);
    const e = entriesUnder(root, rel);
    for (const f of e.files) files.set(f, readFileSync(join(root, f)));
    dirs.push(...e.dirs);
  }
  for (const rel of p.files.keys()) if (!files.has(rel) && existsSync(join(root, rel))) files.set(rel, readFileSync(join(root, rel)));
  return { files, dirs, maps: existsSync(join(root, "maps")) };
}

/** Puts the repo back as the snapshot has it: what the migration wrote goes, and what it moved or changed comes back. */
function restore(root: string, p: MapsPlan, snap: Snapshot): void {
  const now = [...entriesUnder(root, "intent").files, ...entriesUnder(root, "planning").files, ...entriesUnder(root, "maps").files, ...p.files.keys(), ...p.moves.map((m) => m.to)];
  for (const rel of new Set(now)) if (!snap.files.has(rel)) rmSync(join(root, rel), { force: true });
  if (!snap.maps) rmSync(join(root, "maps"), { recursive: true, force: true });
  for (const dir of snap.dirs) mkdirSync(join(root, dir), { recursive: true });
  for (const [rel, bytes] of snap.files) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), bytes);
  }
}

/**
 * Write the plan into the repo: branch, moves, folds, removals, writes, then the check. Anything left under
 * intent/, or a failed check, puts the repo back as it was (and the branch, when this made it).
 */
export function applyMapsPlan(root: string, p: MapsPlan, opts: { git: boolean; branch?: string }): void {
  const snap = snapshotOf(root, p);
  const from = opts.git && opts.branch ? currentBranch(root) : undefined;
  if (opts.git && opts.branch) {
    const r = switchNewBranch(root, opts.branch);
    if (!r.ok) throw new MigrateError(`Couldn't create branch ${opts.branch}: ${r.error}`);
  }
  try {
    for (const m of p.moves) {
      mkdirSync(dirname(join(root, m.to)), { recursive: true });
      renameSync(join(root, m.from), join(root, m.to));
    }
    for (const f of p.folds) rmSync(join(root, f.from), { force: true });
    for (const rel of p.removes) rmSync(join(root, rel), { force: true });
    for (const [rel, body] of p.files) store().write(join(root, rel), body);
    for (const dir of mapDirs(root)) writeMapSummary(root, dir);
    removeEmptyDirs(join(root, "intent"));
    if (existsSync(join(root, "intent"))) {
      throw new MigrateError(`Something is left under intent/, so the migration stopped: ${entriesUnder(root, "intent").files.slice(0, 5).join(", ")}`);
    }
    const errors = mapErrors(root);
    if (errors.length) throw new MigrateError(`The migration left problems. Check them with nikos validate:\n${errors.map((e) => `  ${e}`).join("\n")}`);
  } catch (err) {
    try {
      restore(root, p, snap);
    } catch (restoreErr) {
      throw new MigrateError(`The migration failed and couldn't be undone (${(restoreErr as Error).message}). Check the repo with git status before anything else.`);
    }
    if (from && opts.branch) {
      gitIn(root, ["switch", "-q", from]);
      gitIn(root, ["branch", "-D", opts.branch]);
    }
    const why = err instanceof MigrateError ? err.message : `The migration failed: ${(err as Error).message}`;
    throw new MigrateError(`${why}\nIt was undone: the repo is as it was, and nothing is committed.`, err instanceof MigrateError ? err.code : 1);
  }
}

/** The result of a run: the plan's lines, what happened to it, and how many of the lines were already shown. */
export interface MapsOutcome {
  lines: string[];
  written: boolean;
  /** The first this many lines were shown before the run (the plan, before anything was written). */
  shown: number;
  branch?: string;
  committed?: boolean;
}

/**
 * `nikos migrate maps`. With a terminal and no --yes, asks the map key with its suggestion, then
 * confirms. Without one, every answer must come from a flag: a missing one is a usage error. The plan
 * goes to show() before anything is written, when there is one.
 */
export async function migrateMaps(root: string, opts: MapsOptions, ask?: Ask, tty = false, show?: (lines: string[]) => void): Promise<MapsOutcome> {
  const dir = resolve(root);
  if (!tty && !opts.yes && !opts.dryRun) {
    throw new MigrateError("Nothing written: this isn't a terminal, so pass --yes to write the migration, or --dry-run to see the plan.", 2);
  }
  const git = isGit(dir);
  if (opts.commit && !git) throw new MigrateError("--commit needs a git repo here.", 2);
  preflight(dir, git, opts);
  const storymap: any = parse(read(join(dir, "intent", "storymap.yaml")));
  const interactiveAsk = tty && !!ask && !opts.yes;
  const q = async (question: string, suggestion: string, check: (a: string) => string | undefined): Promise<string> => {
    if (!interactiveAsk) return suggestion;
    for (let n = 0; n < 3; n++) {
      const a = ((await ask!(question, suggestion)).trim() || suggestion).trim();
      const problem = check(a);
      if (!problem) return a;
      question = `${problem} ${question}`;
    }
    throw new MigrateError("No usable answer, so nothing was written.", 2);
  };
  const key = (
    await q(`Map key: the folder is maps/<key>/, named for it`, (opts.key ?? storymap.key).toUpperCase(), (a) => (KEY.test(a.toUpperCase()) ? undefined : "Letters and digits, starting with a letter, up to 10."))
  ).toUpperCase();
  if (!KEY.test(key)) throw new MigrateError(`'${key}' isn't a valid map key (letters and digits, starting with a letter, up to 10)`, 2);

  // The bet: the one local bet the releases name, when planning/ has its card. --new-bet names the bet
  // and writes a stub card for it. Without planning/, no bet can be named in the map, so its links are listed.
  const planning = store().isDir(join(dir, "planning"));
  const named = namedBets(storymap);
  let bet: string | undefined;
  let stub = false;
  if (opts.newBet) {
    if (!BET_ID.test(opts.newBet)) throw new MigrateError(`'${opts.newBet}' is not a bet id (lowercase words joined by hyphens, e.g. faster-checkout)`, 2);
    if (!planning) throw new MigrateError("--new-bet needs a planning/ folder: the bet card goes in planning/bets/. There is no planning/ here.", 2);
    bet = opts.newBet;
    stub = !store().exists(join(planPaths(dir).bets, `${bet}.md`));
  } else if (named.length === 1 && planning) {
    bet = named[0];
    if (!store().exists(join(planPaths(dir).bets, `${bet}.md`))) {
      throw new MigrateError(`planning/bets/${bet}.md doesn't exist: pass --new-bet ${bet} to make a stub, or write the card by hand, then retry.`, 2);
    }
  }

  const answers: Answers = { key, ...(bet ? { bet } : {}), stub };
  const plan = planMapsMigration(dir, answers);
  const problems = targetProblems(dir, plan);
  if (problems.length) {
    throw new MigrateError(`The new layout fails its checks, so nothing was written:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  }
  const lines = renderPlan(plan, !!opts.dryRun);
  if (opts.dryRun) return { lines, written: false, shown: 0 };
  // The plan is shown before the question, and before any write, whether or not there is a question.
  show?.(lines);
  const shown = show ? lines.length : 0;
  if (interactiveAsk) {
    const go = await q("Write these changes? (y/N)", "n", () => undefined);
    if (!/^y/i.test(go)) return { lines: [...lines, "", "Nothing written."], written: false, shown };
  }
  const branch = git && !opts.noBranch ? (opts.branchName ?? MIGRATE_BRANCH) : undefined;
  applyMapsPlan(dir, plan, { git, ...(branch ? { branch } : {}) });
  const out: string[] = [
    "",
    `Moved to maps/${plan.folder}/${branch ? ` on ${branch}` : ""}. ${opts.commit ? "" : "Review the changes, then commit: git add -A && git commit."}`.trim(),
    `This repo holds the whole map in maps/${plan.folder}/. nikos map status writes its delivery.yaml: commit it with the stories.`,
  ];
  let committed: boolean | undefined;
  if (opts.commit) {
    const r = commitMigration(dir, plan);
    committed = r.ok;
    if (!r.ok) throw new MigrateError(`The changes are in place but not committed: ${r.error}. Commit them with git add -A && git commit.`);
    out.push(`Committed on ${branch ?? "the current branch"}. Nothing is pushed.`);
  }
  return { lines: [...lines, ...out], written: true, shown, ...(branch ? { branch } : {}), committed };
}

/**
 * Commit the migration alone, with commitPaths: only the paths the migration wrote, and intent/ for the
 * removals and folds. Anything staged by someone else is left out of the commit.
 */
function commitMigration(root: string, plan: MapsPlan): { ok: boolean; error?: string } {
  const intentTracked = gitIn(root, ["ls-files", "--", "intent"]).stdout.trim() !== "";
  const summaries = mapDirs(root).map((dir) => join(relative(root, dir), "delivery.yaml"));
  const paths = [...new Set([...(intentTracked ? ["intent"] : []), ...plan.moves.map((m) => m.to), ...plan.files.keys(), ...summaries])];
  const r = commitPaths(root, paths, commitMessage(plan.folder));
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "git commit failed" };
}

const FLAGS = ["key", "new-bet", "branch-name", "dir"];
const SWITCHES = ["commit", "dry-run", "yes", "no-branch"];

/** The --options in args that migrate maps doesn't know, so a typo is refused rather than ignored. */
export const unknownFlags = (args: string[]): string[] => args.filter((a) => a.startsWith("--") && ![...FLAGS, ...SWITCHES].includes(a.slice(2)));

/** `nikos migrate maps` from the command line. Returns the exit code. */
export async function runMigrateMaps(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(MIGRATE_MAPS_USAGE);
    return 0;
  }
  const bad = unknownFlags(args);
  if (bad.length) {
    console.error(`✗ Unknown ${bad.length === 1 ? "option" : "options"}: ${bad.join(", ")}\n${MIGRATE_MAPS_USAGE}`);
    return 2;
  }
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (n: string) => args.includes(`--${n}`);
  const opts: MapsOptions = {
    key: flag("key"),
    newBet: flag("new-bet"),
    commit: has("commit"),
    dryRun: has("dry-run"),
    yes: has("yes"),
    noBranch: has("no-branch"),
    branchName: flag("branch-name"),
  };
  const root = flag("dir") ?? process.cwd();
  const tty = interactive();
  const rl = tty ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  try {
    const ask: Ask | undefined = rl ? (q, s) => rl.question(`${q}${s ? ` [${s}]` : ""}: `) : undefined;
    const show = (lines: string[]) => {
      for (const line of lines) console.log(line);
    };
    const r = await migrateMaps(root, opts, ask, tty, show);
    rl?.close();
    for (const line of r.lines.slice(r.shown)) console.log(line);
    return 0;
  } catch (err) {
    rl?.close();
    const e = err as MigrateError;
    console.error(`✗ ${e.message}`);
    return e instanceof MigrateError ? e.code : 1;
  }
}

export const MIGRATE_MAPS_USAGE = "Usage: nikos migrate maps [--dir PATH] [--dry-run] [--yes] [--key KEY] [--new-bet <id>] [--commit] [--no-branch] [--branch-name NAME]";
