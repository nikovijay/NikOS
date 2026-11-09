// `nikos migrate maps`: a 0.2.x repo's intent/ story map moves to maps/<key>/, and the repo becomes a
// group that is its own team (assigned with --repo .). Nothing moves until the plan is shown and
// confirmed. The new layout is checked on a copy of the repo first, so a failed check writes nothing.
// The changes are left uncommitted on nikos/migrate-maps, or committed with --commit. Nothing is pushed.
// If the repo changes and then fails (a write, or the check), the repo is put back as it was.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { isMap, isSeq, parse, parseDocument, stringify } from "yaml";
import { BET_ID, CROSS_REF } from "../lib/bets.js";
import { betText, checkBet, paths as planPaths } from "../planning/model.js";
import { planningIssues } from "../planning/levels.js";
import { planYaml } from "../lib/group-plan.js";
import { store } from "../lib/store.js";
import { count, read, walk } from "../lib/project.js";
import { mapDirs } from "../lib/maps.js";
import { writeMapSummary } from "../lib/map-summary.js";
import { isTeamRepo, openTeam, TEAM_FILE } from "../lib/team.js";
import { upstreamEntries } from "../planning/upstream.js";
import { branchExists, commitPaths, currentBranch, gitIn, isGit, pathOf, statusOf, switchNewBranch } from "../lib/git.js";
import { codeownersFile, moveCodeowners } from "../lib/codeowners.js";
import { rewriteRunnerPaths } from "../lib/runner-paths.js";
import { newIdFor, renameDecisionHeadings, renameIds, retagFeature, type IdTable } from "../lib/id-rename.js";
import { keyFor } from "./init.js";
import { currentQuarter, type Ask } from "./onboard.js";
import { interactive } from "./start.js";
import { KEY } from "../lib/keys.js";
import { validateMap, validateGroup, validateTeam } from "./validate.js";

const MIGRATE_BRANCH = "nikos/migrate-maps";
const commitMessage = (folder: string) => `Migrate intent/ to maps/${folder}/ (nikos migrate maps)`;
/** What intent/ may hold. Each of these moves; anything else stops the migration. */
const MOVED = ["storymap.yaml", "features", "state.yaml", "state", "approvals.yaml", "approvals", "plans", "constitution.md", "decisions.md"];
/** Files migrate removes rather than moves: a placeholder, or a Finder or Explorer file that isn't part of the map. */
const JUNK = [".DS_Store", "Thumbs.db"];
const KNOWN = [...MOVED, ".gitkeep", ...JUNK];
const RUNNERS = ["cucumber.mjs", "cucumber.js", "behave.ini"];

/** The validate error for a release or story that names a bet with no card yet. The bet choice writes it, or refuses. */
const MISSING_CARD = /, which has no planning\/bets\/[^\s]+\.md$/;

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
  /** A team repo: its key (WEB), when nikos.team.yaml has none yet. */
  teamKey?: string;
  /** A team repo: the plan it is homed in (owner/repo), when nikos.team.yaml has none yet. */
  home?: string;
  groupKey?: string;
  name?: string;
  period?: string;
  bet?: string;
  newBet?: string;
  renameIds?: boolean;
  team?: string;
  commit?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  noBranch?: boolean;
  branchName?: string;
}

export interface Answers {
  key: string;
  /** The group key, or a team's key in a team repo: the prefix of its story ids. */
  group: string;
  bet: string;
  /** --new-bet: write a stub bet card with the migration. */
  stub: boolean;
  renameIds: boolean;
  period: string;
  name: string;
  team: string;
  /** A team repo: nikos.team.yaml gets the key and home it lacks. No plan is written. */
  teamFile?: { key: string; home: string };
}

export interface MapsPlan {
  root: string;
  key: string;
  folder: string;
  /** group, or team for a team repo that owns the map. */
  owner: "group" | "team";
  group: string;
  name: string;
  period: string;
  team: string;
  bet: string;
  /** Files moved from intent/, as repo-relative paths. */
  moves: { from: string; to: string }[];
  /** Files under intent/ that are removed, not moved: placeholders and Finder or Explorer files. */
  removes: string[];
  /** Every file the migration writes, moved or new or changed, with the text it ends with. */
  files: Map<string, string>;
  /** Paths the migration creates (not moved, not rewritten). */
  creates: string[];
  plan: "create" | "keep" | "team-to-group" | "group-key" | "team";
  /** For group-key: the plan fields the migration fills in, e.g. "key PAY, period Q1 2027". */
  planNote?: string;
  /** A team repo: what nikos.team.yaml gains, e.g. "key WEB, home acme/payments-plan added". */
  teamLine?: string;
  /** Renamed story ids, old and new. */
  renames: [string, string][];
  edits: number;
  editedFiles: number;
  /** Bet links that were dropped, and the links the person re-adds by hand. */
  dropped: string[];
  /** Whether the releases or stories named bets at all (their lines are dropped from the file). */
  hadBets: boolean;
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

/** A plan field as text, or undefined when the plan doesn't have it. */
const text = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));

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

/** The story ids in the releases, and the id each gets under the group: KEY-n becomes GROUP-KEY-n. */
function idTable(storymap: any, group: string, key: string): { table: IdTable; needs: string[]; stray: string[] } {
  const table: IdTable = new Map();
  const needs: string[] = [];
  const stray: string[] = [];
  for (const r of storymap.releases ?? []) {
    for (const id of Array.isArray(r?.stories) ? r.stories : []) {
      const next = newIdFor(id, storymap.key, group, key);
      if (!next) stray.push(id);
      else if (next !== id) {
        table.set(id, next);
        needs.push(id);
      }
    }
  }
  return { table, needs, stray };
}

/** The plan.yaml state: absent, a team plan (rewritten), a group plan (kept), or a plan above the group (refused). */
function planState(root: string): { exists: boolean; level?: string; obj?: any } {
  const path = join(root, "planning", "plan.yaml");
  if (!store().exists(path)) return { exists: false };
  const obj = yamlOf(path);
  return { exists: true, level: typeof obj?.level === "string" ? obj.level : undefined, obj };
}

/** Whether a file under intent/ (by its path there) is one a move picks up. */
const isMoved = (rel: string) =>
  ["storymap.yaml", "state.yaml", "approvals.yaml", "constitution.md", "decisions.md"].includes(rel) ||
  (rel.startsWith("features/") && rel.endsWith(".feature")) ||
  (rel.startsWith("state/") && rel.endsWith(".yaml")) ||
  (rel.startsWith("approvals/") && rel.endsWith(".yaml")) ||
  (rel.startsWith("plans/") && rel.endsWith(".md"));

const isJunk = (rel: string) => basename(rel) === ".gitkeep" || JUNK.includes(basename(rel));

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

/** Refusals that need no answer: the repo's shape, its git state, and its intent/ folder. */
function preflight(root: string, opts: MapsOptions, git: boolean): void {
  const intent = join(root, "intent");
  if (store().isDir(join(root, "maps")) || mapDirs(root).length) throw new MigrateError("This repo already has maps/. Migrate needs a repo with intent/ and no maps/.");
  if (!store().exists(join(intent, "storymap.yaml"))) throw new MigrateError("Nothing to migrate: there is no intent/storymap.yaml here.");
  // A team repo takes its own map in place (maps/<key>/, rule 2): its nikos.team.yaml must read first.
  if (isTeamRepo(root)) {
    try {
      openTeam(root);
    } catch (err) {
      throw new MigrateError(`${(err as Error).message}. Fix ${TEAM_FILE}, then retry.`);
    }
  }
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
  if (store().exists(join(root, "planning", "decisions.md")) && store().exists(join(intent, "decisions.md"))) {
    throw new MigrateError("planning/decisions.md and intent/decisions.md both exist. Merge them by hand, then retry.");
  }
  // A missing bet card is the bet choice's to write (as a stub) or refuse, not the source check's.
  // The map is checked as the intent/ map it is, before anything moves; a team's bets are its own, so a bet card is its to write.
  const errors = validateMap({ root, dir: intent }).errors.filter((e) => !(e.file === "storymap.yaml" && MISSING_CARD.test(e.message)));
  if (errors.length) {
    throw new MigrateError(`Fix intent/ first: nikos validate lists ${count(errors.length, "problem")}. Nothing has been moved.\n${errors.map((e) => `  ${e.file}: ${e.message}`).join("\n")}`);
  }
  const plan = planState(root);
  if (plan.level === "company" || plan.level === "department") {
    throw new MigrateError(`planning/plan.yaml is a ${plan.level} plan. A repo holds one plan: put the group in its own repo.`);
  }
  if (plan.level === "team") {
    const krs = walk(join(root, "planning", "krs"), ".yaml").length;
    const objectives = Array.isArray(plan.obj?.objectives) ? plan.obj.objectives.length : 0;
    if (krs || objectives) {
      const what = krs ? count(krs, "key result") : count(objectives, "objective");
      throw new MigrateError(
        `planning/plan.yaml is a team plan with ${what}. A group plan has none. Move each to the department's plan, or rewrite it as a bet aimed at a department key result (krs: <department repo>#<kr-id>), then retry.`,
      );
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
  const { table, needs, stray } = idTable(storymap, a.group, a.key);
  if (stray.length) throw new MigrateError(`Story ${stray.join(", ")} doesn't start with ${storymap.key}-, so it can't be renamed. Rename it by hand, then retry.`);
  if (needs.length && !a.renameIds) {
    throw new MigrateError(
      `${count(needs.length, "story id")} don't carry the ${a.teamFile ? "team" : "group"} key (${a.group}): ${needs.join(", ")}.\nRerun with --rename-ids to rename them (${storymap.key}-n becomes ${a.group}-${a.key}-n), or add the ${a.teamFile ? "team" : "group"} key by hand. Nothing has been moved.`,
    );
  }
  const renames = a.renameIds ? [...table.entries()] : [];
  const useTable: IdTable = a.renameIds ? table : new Map();

  const files = new Map<string, string>();
  const moves: MapsPlan["moves"] = [];
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

  // storymap.yaml: ids renamed, key set to the map's, bet: added; bets: and story_bets: dropped (validate refuses them in a group).
  const dropped: string[] = [];
  for (const { where, ref } of betRefs(storymap)) {
    if (ref === a.bet) continue; // the map's bet, named in bet: now
    if (CROSS_REF.test(ref)) dropped.push(`${where} ${ref}: a bet in another repo can't be named here, so it's dropped`);
    else dropped.push(`${where} ${ref}: add it to planning/bets/${a.bet}.md by hand`);
  }
  const renamed = renameIds(storyText, useTable);
  const withKey = renamed.text.replace(/^key:.*$/m, (line) => `${line.replace(/^key:.*$/, `key: ${a.key}`)}\nbet: ${a.bet}`);
  const doc = parseDocument(withKey);
  doc.delete("story_bets");
  const releases = doc.get("releases");
  if (isSeq(releases)) for (const item of releases.items) if (isMap(item)) item.delete("bets");
  place("intent/storymap.yaml", `${target}/storymap.yaml`, doc.toString({ flowCollectionPadding: false }), renamed.count);

  // Features: the tags above Feature: only. The spec hash covers the rest, so approvals hold.
  for (const path of walk(join(intent, "features"), ".feature")) {
    const rel = under(intent, path);
    const r = retagFeature(read(path), useTable);
    place(`intent/${rel}`, `${target}/${rel}`, r.text, r.count);
  }

  // State and approvals: keys and the file names. Ticket values stay. Nested files keep their folder.
  // A team's are different (D1): its status and approvals are one file per story at the team's root, not in the map.
  const stateTexts: string[] = [];
  const teamFileOf = (folder: string, rel: string) => `${folder}/${renameIds(rel, useTable).text}`;
  // A team's one state.yaml and approvals.yaml split into a file per story: each is written, and the source removed.
  const split: string[] = [];
  if (store().exists(join(intent, "state.yaml"))) {
    const t = read(join(intent, "state.yaml"));
    stateTexts.push(t);
    if (a.teamFile) {
      for (const [id, entry] of Object.entries<any>(parse(t)?.stories ?? {})) files.set(teamFileOf("status", `${id}.yaml`), stringify(entry));
      split.push("intent/state.yaml");
    } else {
      const r = renameLines(t, useTable);
      place("intent/state.yaml", `${target}/state.yaml`, r.text, r.count);
    }
  }
  for (const f of walk(join(intent, "state"), ".yaml")) {
    const t = read(f);
    stateTexts.push(t);
    const rel = under(join(intent, "state"), f);
    if (a.teamFile) {
      place(`intent/state/${rel}`, teamFileOf("status", rel), t);
      continue;
    }
    const r = renameIds(rel, useTable);
    place(`intent/state/${rel}`, `${target}/state/${r.text}`, t, r.count);
  }
  if (store().exists(join(intent, "approvals.yaml"))) {
    if (a.teamFile) {
      for (const [id, entry] of Object.entries<any>(parse(read(join(intent, "approvals.yaml"))) ?? {})) files.set(teamFileOf("approvals", `${id}.yaml`), stringify(entry));
      split.push("intent/approvals.yaml");
    } else {
      const r = renameLines(read(join(intent, "approvals.yaml")), useTable);
      place("intent/approvals.yaml", `${target}/approvals.yaml`, r.text, r.count);
    }
  }
  for (const f of walk(join(intent, "approvals"), ".yaml")) {
    const rel = under(join(intent, "approvals"), f);
    if (a.teamFile) {
      place(`intent/approvals/${rel}`, teamFileOf("approvals", rel), read(f));
      continue;
    }
    const r = renameIds(rel, useTable);
    place(`intent/approvals/${rel}`, `${target}/approvals/${r.text}`, read(f), r.count);
  }

  // Plans: their names and bodies. Plans aren't hashed, so their text can change.
  for (const f of walk(join(intent, "plans"), ".md")) {
    const rel = under(join(intent, "plans"), f);
    const body = renameIds(read(f), useTable);
    const name = renameIds(rel, useTable);
    place(`intent/plans/${rel}`, `${target}/plans/${name.text}`, body.text, body.count + name.count);
  }

  if (store().exists(join(intent, "constitution.md"))) place("intent/constitution.md", `${target}/constitution.md`, read(join(intent, "constitution.md")));
  if (store().exists(join(intent, "decisions.md"))) {
    const d = renameDecisionHeadings(read(join(intent, "decisions.md")), useTable);
    place("intent/decisions.md", "planning/decisions.md", d.text, d.count);
    creates.push("planning/decisions.md");
  }

  // The plan, the stub bet and the group's own assignment. A team repo has no plan: its file gets the key and home it lacks.
  const plan = planState(root);
  let action: MapsPlan["plan"] = "create";
  let planNote: string | undefined;
  let teamLine: string | undefined;
  if (a.teamFile) {
    action = "team";
    const before = read(join(root, TEAM_FILE));
    const doc = parseDocument(before);
    const added = [doc.has("key") ? "" : `key ${a.teamFile.key}`, doc.has("home") ? "" : `home ${a.teamFile.home}`].filter(Boolean);
    if (added.length) {
      files.set(TEAM_FILE, teamFileWith(before, a.teamFile));
      teamLine = `${added.join(", ")} added (format_version 2)`;
    }
  } else if (!plan.exists) {
    files.set("planning/plan.yaml", planYaml({ name: a.name, key: a.group, period: a.period, level: "group", pillars: [] }));
    creates.push("planning/plan.yaml");
  } else if (plan.level === "team") {
    action = "team-to-group";
    files.set("planning/plan.yaml", planYaml({ name: plan.obj?.name ?? a.name, key: a.group, period: text(plan.obj?.period) ?? a.period, level: "group", pillars: plan.obj?.pillars ?? [] }));
  } else if (plan.level === "group") {
    action = "keep";
    if (plan.obj?.key !== undefined && plan.obj.key !== a.group) throw new MigrateError(`planning/plan.yaml's key is ${plan.obj.key}, not ${a.group}: pass --group-key ${plan.obj.key}`, 2);
    // A group plan keeps what it has; a missing key, period or name is filled in from the answers.
    const added = [plan.obj?.key === undefined ? `key ${a.group}` : "", plan.obj?.period === undefined ? `period ${a.period}` : "", plan.obj?.name === undefined ? `name ${a.name}` : ""].filter(Boolean);
    if (added.length) {
      action = "group-key";
      planNote = added.join(", ");
      files.set("planning/plan.yaml", stringify({ ...plan.obj, key: a.group, period: text(plan.obj?.period) ?? a.period, name: plan.obj?.name ?? a.name }));
    }
  }
  if (a.stub) {
    files.set(`planning/bets/${a.bet}.md`, stubBetText(a.bet, a.team));
    creates.push(`planning/bets/${a.bet}.md`);
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
  if (a.renameIds) {
    const kept = ticketsIn(stateTexts);
    if (kept.length) notChanged.push(`ticket values kept: ${kept.join(", ")}`);
  }
  const grepped = a.renameIds ? otherMentions(root, renames.map(([old]) => old)) : [];
  notChanged.push(...grepped);

  // Two moves onto one path would overwrite each other: refused, not written.
  const dest = new Set<string>();
  for (const m of moves) {
    if (dest.has(m.to)) throw new MigrateError(`Two files would both move to ${m.to}. Rename one by hand, then retry.`);
    dest.add(m.to);
  }
  const { removes: junk } = sortIntent(root);
  const removes = [...junk, ...split];
  return {
    root,
    key: a.key,
    folder,
    owner: a.teamFile ? "team" : "group",
    group: a.group,
    name: a.name,
    period: a.period,
    team: a.team,
    bet: a.bet,
    moves,
    removes,
    files,
    creates,
    plan: action,
    ...(planNote ? { planNote } : {}),
    ...(teamLine ? { teamLine } : {}),
    renames,
    edits,
    editedFiles: edited.size,
    dropped,
    hadBets: betRefs(storymap).length > 0,
    notChanged,
    runner,
    codeowners,
  };
}

/**
 * A team's nikos.team.yaml with the key and home it lacks added, and format 2 when either is new (0.3.0 can't
 * read it). The rest of the file keeps its comments and order.
 */
function teamFileWith(text: string, want: { key: string; home: string }): string {
  const doc = parseDocument(text);
  const added = !doc.has("key") || !doc.has("home");
  if (!doc.has("key")) doc.set("key", want.key);
  if (!doc.has("home")) doc.set("home", want.home);
  if (added) doc.set("format_version", 2);
  return doc.toString({ flowCollectionPadding: false });
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

/** What the group's checks say about the repo as it is: planning and maps, with warnings left out. A team repo's checks are its own. A check that throws is a problem too. */
function groupErrors(root: string): string[] {
  try {
    return [
      ...(isTeamRepo(root) ? validateTeam(root).errors : validateGroup(root).errors).map((e) => `${e.file}: ${e.message}`),
      ...planningIssues(root)
        .filter((i) => !i.warning)
        .map((i) => `${i.file}: ${i.message}`),
    ];
  } catch (err) {
    return [(err as Error).message];
  }
}

/** The temp-tree check: the new layout, built in a copy of planning/, intent/ and the upstream cache, must pass validate. */
export function targetProblems(root: string, plan: MapsPlan): string[] {
  const tmp = mkdtempSync(join(tmpdir(), "nikos-migrate-"));
  try {
    for (const rel of ["planning", "intent", TEAM_FILE, join(".nikos", "upstream")]) {
      if (store().exists(join(root, rel))) cpSync(join(root, rel), join(tmp, rel), { recursive: true });
    }
    // The copy ends as the real apply does: moved files gone from intent/, the rest removed with it.
    for (const m of plan.moves) rmSync(join(tmp, m.from), { force: true });
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
    return groupErrors(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The plan as the person reads it: each move, each removal, each created file, the ids, and what to check by hand. */
export function renderPlan(p: MapsPlan, dry: boolean): string[] {
  const out: string[] = [`nikos migrate maps: intent/ -> maps/${p.folder}/ under ${p.owner === "team" ? `team key ${p.group}` : `group ${p.group}`}${dry ? " (dry run: nothing written)" : ""}`, "", "Moves"];
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
    const note = item === "storymap.yaml" ? ` (bet: ${p.bet}${p.hadBets ? "; bets: and story_bets: dropped" : ""})` : item === "decisions.md" ? " (created)" : "";
    out.push(`  ${from.padEnd(30)} -> ${to}${note}`);
  }
  for (const r of p.removes) {
    const why = r === "intent/state.yaml" || r === "intent/approvals.yaml" ? "split into status/ and approvals/, one file per story" : basename(r) === ".gitkeep" ? "an empty folder's placeholder" : "a Finder or Explorer file, not part of the map";
    out.push(`  ${r.padEnd(30)} removed (${why})`);
  }
  if (p.owner === "team") {
    if (p.teamLine) out.push("Changes", `  ${TEAM_FILE.padEnd(30)} ${p.teamLine}`);
  } else out.push("Creates", `  ${"planning/plan.yaml".padEnd(30)} ${planLine(p)}`);
  for (const f of p.creates) if (f.startsWith("planning/bets/")) out.push(`  ${f.padEnd(30)} (stub, from --new-bet)`);
  if (p.renames.length) {
    out.push(`Ids (--rename-ids): ${count(p.renames.length, "id")}, ${count(p.edits, "edit")} in ${count(p.editedFiles, "file")}`, `  ${p.renames.map(([o, n]) => `${o} -> ${n}`).join(", ")}`);
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

const planLine = (p: MapsPlan) => {
  if (p.plan === "create") return `level group, key ${p.group}, period ${p.period}`;
  if (p.plan === "team-to-group") return `level team -> group, key ${p.group} (name and pillars kept, period ${p.period})`;
  if (p.plan === "group-key") return `${p.planNote} added`;
  return "kept";
};

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
 * Write the plan into the repo: branch, moves, removals, writes, then the check. Anything left under
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
    for (const rel of p.removes) rmSync(join(root, rel), { force: true });
    for (const [rel, body] of p.files) store().write(join(root, rel), body);
    for (const dir of mapDirs(root)) writeMapSummary(root, dir);
    removeEmptyDirs(join(root, "intent"));
    if (existsSync(join(root, "intent"))) {
      throw new MigrateError(`Something is left under intent/, so the migration stopped: ${entriesUnder(root, "intent").files.slice(0, 5).join(", ")}`);
    }
    const errors = groupErrors(root);
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
 * A team repo's key and home for its own map, from nikos.team.yaml or the flags. A team needs both before
 * its map can be checked: the key names its story ids and the home is where its settings come from.
 */
export function teamAnswers(dir: string, opts: MapsOptions): { key: string; home: string } {
  const team = openTeam(dir);
  const key = (opts.teamKey ?? team.key ?? "").toUpperCase();
  if (!key) throw new MigrateError(`This team repo has no key, and its own map needs one: pass --team-key WEB, or add key: WEB to ${TEAM_FILE}, then retry.`, 2);
  if (!KEY.test(key)) throw new MigrateError(`'${key}' isn't a valid team key (letters and digits, starting with a letter, up to 10)`, 2);
  if (team.key && team.key !== key) throw new MigrateError(`${TEAM_FILE}'s key is ${team.key}, not ${key}: pass --team-key ${team.key}`, 2);
  if (team.home && opts.home && team.home !== opts.home) throw new MigrateError(`${TEAM_FILE}'s home is ${team.home}, not ${opts.home}: a team has one home`, 2);
  const home = opts.home ?? team.home;
  if (!home) throw new MigrateError("This team has no home: pass --home <repo> for a plan it joins (nikos join <repo> --home), then retry.", 2);
  if (!(upstreamEntries(dir).some((e) => e.repo === home) || team.groups.some((g) => g.repo === home))) {
    throw new MigrateError(`${home} isn't a plan this team joins: nikos join ${home} --home first, then retry.`, 2);
  }
  return { key, home };
}

/**
 * `nikos migrate maps`. With a terminal and no --yes, asks each question with its suggestion, then
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
  preflight(dir, opts, git);
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
  const planPlan = planState(dir);
  // A team repo's map takes the team's key and home from nikos.team.yaml (or the flags), and has no plan to ask about.
  const teamMode = isTeamRepo(dir);
  const teamSpec = teamMode ? teamAnswers(dir, opts) : undefined;
  const key = (
    await q(`Map key: every story id in it starts with ${storymap.key}-, and the folder is named for it`, (opts.key ?? storymap.key).toUpperCase(), (a) => (KEY.test(a.toUpperCase()) ? undefined : "Letters and digits, starting with a letter, up to 10."))
  ).toUpperCase();
  if (!KEY.test(key)) throw new MigrateError(`'${key}' isn't a valid map key (letters and digits, starting with a letter, up to 10)`, 2);
  const groupSuggestion = (planPlan.level === "group" && typeof planPlan.obj?.key === "string" ? planPlan.obj.key : undefined) ?? keyFor(basename(dir));
  const groupAnswer = teamSpec
    ? teamSpec.key
    : (opts.groupKey ?? (await q(`Group key: the prefix of every story id (${groupSuggestion}-${key}-1). Letters and digits, starting with a letter.`, groupSuggestion, (a) => (KEY.test(a.toUpperCase()) ? undefined : "Letters and digits, starting with a letter, up to 10."))));
  const group = groupAnswer.toUpperCase();
  if (!KEY.test(group)) throw new MigrateError(`'${groupAnswer}' isn't a valid group key (letters and digits, starting with a letter, up to 10)`, 2);
  // A flag can't change what the plan already says: that's a refusal, not a silent drop.
  const clash = (label: "period" | "name", flag: string | undefined, have: unknown) => {
    if (flag !== undefined && have !== undefined && String(have) !== flag) {
      throw new MigrateError(`planning/plan.yaml's ${label} is "${String(have)}", not "${flag}". Change the plan, or drop --${label}.`, 2);
    }
  };
  clash("period", opts.period, planPlan.obj?.period);
  clash("name", opts.name, planPlan.obj?.name);
  const period = teamMode ? "" : planPlan.exists && planPlan.obj?.period ? String(planPlan.obj.period) : (opts.period ?? (await q("Planning period", currentQuarter(), (a) => (a ? undefined : "It needs a period."))));
  const name = teamMode ? "" : planPlan.exists && planPlan.obj?.name ? String(planPlan.obj.name) : (opts.name ?? (await q("Group name", storymap.project ?? basename(dir), (a) => (a ? undefined : "It needs a name."))));
  const team = opts.team ?? (teamMode ? openTeam(dir).name : basename(dir));

  // The bet: the one the releases name, or the flag, or the question. A team's bet may be one of a plan it joins (<repo>#<id>).
  const named = namedBets(storymap);
  let bet: string | undefined;
  let stub = false;
  if (opts.bet && opts.newBet) throw new MigrateError("Pass --bet or --new-bet, not both.", 2);
  if (opts.bet && CROSS_REF.test(opts.bet)) {
    if (!teamMode) throw new MigrateError(`'${opts.bet}' names another repo's bet: a group's map specs one of its own (planning/bets/)`, 2);
    const repo = opts.bet.split("#")[0];
    if (!teamSpec || !(upstreamEntries(dir).some((e) => e.repo === repo) || openTeam(dir).groups.some((g) => g.repo === repo))) {
      throw new MigrateError(`${repo} isn't a plan this team joins: nikos join ${repo} first, then retry`, 2);
    }
    bet = opts.bet;
  } else if (opts.bet) {
    if (!BET_ID.test(opts.bet)) throw new MigrateError(`'${opts.bet}' is not a bet id (lowercase words joined by hyphens, e.g. faster-checkout)`, 2);
    if (!store().exists(join(planPaths(dir).bets, `${opts.bet}.md`))) throw new MigrateError(`planning/bets/${opts.bet}.md doesn't exist: create it, or pass --new-bet ${opts.bet} to make a stub.`);
    bet = opts.bet;
  } else if (opts.newBet) {
    if (!BET_ID.test(opts.newBet)) throw new MigrateError(`'${opts.newBet}' is not a bet id (lowercase words joined by hyphens, e.g. faster-checkout)`, 2);
    if (store().exists(join(planPaths(dir).bets, `${opts.newBet}.md`))) throw new MigrateError(`planning/bets/${opts.newBet}.md already exists: pass --bet ${opts.newBet} to use it.`);
    bet = opts.newBet;
    stub = true;
  } else if (named.length === 1) {
    bet = named[0];
    if (!store().exists(join(planPaths(dir).bets, `${bet}.md`))) {
      const missing = `planning/bets/${bet}.md doesn't exist: pass --new-bet ${bet} to make a stub, or --bet <id> for an existing card.`;
      if (!interactiveAsk) throw new MigrateError(missing, 2);
      stub = /^y/i.test(await q(`planning/bets/${bet}.md doesn't exist. Write a stub card for it? (y/N)`, "y", () => undefined));
      if (!stub) throw new MigrateError(missing, 2);
    }
  } else if (!interactiveAsk) {
    throw new MigrateError(
      named.length > 1 ? `Several bets are named (${named.join(", ")}): pass --bet <id> to choose the one this map specs.` : "No bet is named in the releases: pass --bet <id> for an existing bet, or --new-bet <id> to make a stub.",
      2,
    );
  } else {
    bet = await q(named.length > 1 ? `Which bet does this map spec? One of ${named.join(", ")}` : "Which bet does this map spec? An existing id, or a new one (a stub is written)", named[0] ?? "", (a) => (BET_ID.test(a) ? undefined : "Lowercase words joined by hyphens, e.g. faster-checkout."));
    if (!store().exists(join(planPaths(dir).bets, `${bet}.md`))) stub = true;
  }

  // Renaming the ids is asked only when some need it, with the full list shown first.
  const { needs } = idTable(storymap, group, key);
  let renameIds = !!opts.renameIds;
  if (needs.length && !renameIds && interactiveAsk) {
    const shown = needs.map((id) => `${id} -> ${group}-${key}-${id.slice(id.lastIndexOf("-") + 1)}`).join(", ");
    const yes = await q(`Rename ${count(needs.length, "story id")} to ${group}-${key}-n? ${shown}. (y/N)`, "n", () => undefined);
    renameIds = /^y/i.test(yes);
  }

  const answers: Answers = { key, group, bet: bet!, stub, renameIds, period, name, team, ...(teamSpec ? { teamFile: teamSpec } : {}) };
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
    plan.owner === "team"
      ? `This team owns maps/${plan.folder}/: its stories are ${plan.group}-${plan.key}-n. nikos map status writes its delivery.yaml: commit it with the stories.`
      : `This repo holds the whole map in maps/${plan.folder}/. nikos map status writes its delivery.yaml: commit it with the stories.`,
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
 * removals. Anything staged by someone else is left out of the commit.
 */
function commitMigration(root: string, plan: MapsPlan): { ok: boolean; error?: string } {
  const intentTracked = gitIn(root, ["ls-files", "--", "intent"]).stdout.trim() !== "";
  const summaries = mapDirs(root).map((dir) => join(relative(root, dir), "delivery.yaml"));
  const paths = [...new Set([...(intentTracked ? ["intent"] : []), ...plan.moves.map((m) => m.to), ...plan.files.keys(), ...summaries])];
  const r = commitPaths(root, paths, commitMessage(plan.folder));
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "git commit failed" };
}

const FLAGS = ["key", "group-key", "team-key", "home", "name", "period", "bet", "new-bet", "team", "branch-name", "dir"];
const SWITCHES = ["rename-ids", "commit", "dry-run", "yes", "no-branch"];

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
    groupKey: flag("group-key"),
    teamKey: flag("team-key"),
    home: flag("home"),
    name: flag("name"),
    period: flag("period"),
    bet: flag("bet"),
    newBet: flag("new-bet"),
    renameIds: has("rename-ids"),
    team: flag("team"),
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

export const MIGRATE_MAPS_USAGE = "Usage: nikos migrate maps [--dir PATH] [--dry-run] [--yes] [--key KEY] [--group-key GROUP] [--team-key KEY] [--home <repo>] [--bet <id> | <repo>#<id> | --new-bet <id>] [--rename-ids] [--name TEXT] [--period TEXT] [--team NAME] [--commit] [--no-branch] [--branch-name NAME]";
