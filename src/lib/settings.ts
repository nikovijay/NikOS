// Settings in nikos.settings.yaml, at a repo's root. A company sets them once; departments and groups
// inherit them through planning/upstream.yaml (synced into .nikos/upstream/), and can
// change any value the levels above haven't locked. Each value remembers where it came from.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import { parse, parseDocument } from "yaml";
import { store } from "./store.js";
import { REPO_PATH } from "./bets.js";
import { areaOf, type Area } from "../planning/model.js";
import { chainOf } from "../plan/repo.js";

const Ajv2020 = (Ajv2020Module as any).default ?? Ajv2020Module;
const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = [join(here, "../../schemas"), join(here, "../schemas")].find((d) => existsSync(d))!;
const check = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(schemaDir, "settings.schema.json"), "utf8")));

export const SETTINGS_FILE = "nikos.settings.yaml";
export type ApprovalPolicy = "off" | "optional" | "required-for-release";
export type ApprovalRoute = "app" | "chat" | "terminal";

/** Every setting nikOS knows, with its default. Keys are dotted paths into the file. */
export const DEFAULTS: Record<string, unknown> = {
  "approval.policy": "optional",
  "approval.routes": ["app", "chat", "terminal"],
  "tracker.system": "none",
  "tracker.site": "",
  "tracker.project": "",
  "tracker.statuses": {},
  "tracker.approvals": false,
};

export interface Setting {
  value: unknown;
  /** "default", "this repo", or the repo path of the level it came from. */
  from: string;
  /** The level that locked it, if one did. */
  lockedBy?: string;
}
export type Resolved = Record<string, Setting>;

const flatten = (data: any): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULTS)) {
    const value = key.split(".").reduce<any>((v, k) => (v == null ? undefined : v[k]), data);
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/** Why a settings file's text doesn't read, or undefined when it does. */
export function checkSettingsText(text: string): string | undefined {
  let data: unknown;
  try {
    data = parse(text) ?? {};
  } catch (err) {
    return `${SETTINGS_FILE}: ${(err as Error).message.split("\n")[0]}`;
  }
  if (check(data)) return undefined;
  const e = check.errors![0];
  return `${SETTINGS_FILE}: ${e.instancePath.replace(/^\//, "").replace(/\//g, ".") || "(root)"} ${e.message}`;
}

/** A repo's own settings file, parsed and checked. */
export function readSettings(root: string): { values: Record<string, unknown>; locked: string[] } {
  const path = join(root, SETTINGS_FILE);
  if (!store().exists(path)) return { values: {}, locked: [] };
  const text = store().read(path);
  const bad = checkSettingsText(text);
  if (bad) throw new Error(bad);
  const data = parse(text) ?? {};
  return { values: flatten(data), locked: data.locked ?? [] };
}

/** The repo paths this repo (or a synced copy) names as its upstreams, in order. */
function upstreamsOf(dir: string): string[] {
  const path = join(dir, "planning", "upstream.yaml");
  if (!store().exists(path)) return [];
  const list = parse(store().read(path));
  return Array.isArray(list) ? list.map((e: any) => e?.repo).filter((r: unknown): r is string => typeof r === "string" && REPO_PATH.test(r)) : [];
}

/**
 * The plan a group or department is homed in, when its planning/upstream.yaml marks one with home: true.
 * Its settings and locks come from that plan's chain alone (amendment, rule 5). Without a mark, the
 * repo takes every plan it joined, as before.
 */
function homeUpstreamOf(dir: string): string | undefined {
  const path = join(dir, "planning", "upstream.yaml");
  if (!store().exists(path)) return undefined;
  const list = parse(store().read(path));
  const home = Array.isArray(list) ? list.find((e: any) => e?.home === true) : undefined;
  return typeof home?.repo === "string" ? home.repo : undefined;
}

/**
 * The settings that apply to a repo: defaults, then each level above it from the top down
 * (through the synced copies in .nikos/upstream/), then the repo's own. A level can't change a
 * value a level above it locked.
 */
export function resolveSettings(root: string): Resolved {
  return resolveSettingsDetailed(root).resolved;
}

/** resolveSettings, with the problems found in the levels above (a group copy that doesn't read, or two locks that disagree). */
export function resolveSettingsDetailed(root: string): { resolved: Resolved; problems: string[] } {
  const area = areaOf(root);
  if (area) return areaSettings(area);
  const cache = join(resolve(root), ".nikos", "upstream");
  const out: Resolved = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, { value: v, from: "default" }]));
  const visiting = new Set<string>();
  const apply = (dir: string, name: string) => {
    if (visiting.has(dir)) return; // a loop of upstreams: each level counts once
    visiting.add(dir);
    const home = homeUpstreamOf(dir);
    for (const up of home ? [home] : upstreamsOf(dir)) {
      const copy = join(cache, ...up.split("/"));
      if (store().exists(copy)) apply(copy, up);
    }
    const own = readSettings(dir);
    for (const [key, value] of Object.entries(own.values)) {
      if (out[key].lockedBy) continue;
      out[key] = { value, from: name };
    }
    for (const key of own.locked) if (out[key] && !out[key].lockedBy) out[key].lockedBy = name;
  };
  apply(resolve(root), "this repo");
  return { resolved: out, problems: [] };
}

/** An area's own settings file: the company's is nikos.settings.yaml at the root, any other area's is its settings.yaml. */
const areaSettingsFile = (area: Area) => (area.level === "company" ? join(area.repo, SETTINGS_FILE) : join(area.dir, "settings.yaml"));

/**
 * The settings for an area of a planning repo: the company's, then each level down the folders to
 * this one. Each level changes what nobody above it locked. See docs/rfcs/plan-and-spec.md, rule 6.
 */
function areaSettings(area: Area): { resolved: Resolved; problems: string[] } {
  const out: Resolved = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, { value: v, from: "default" }]));
  const problems: string[] = [];
  for (const level of chainOf(area)) {
    const path = areaSettingsFile(level);
    if (!store().exists(path)) continue;
    const text = store().read(path);
    const bad = checkSettingsText(text);
    if (bad) {
      problems.push(`${level.rel}'s settings are skipped: ${bad.replace(SETTINGS_FILE, relative(area.repo, path))}`);
      continue;
    }
    const data = parse(text) ?? {};
    for (const [key, value] of Object.entries(flatten(data))) if (!out[key].lockedBy) out[key] = { value, from: level.rel };
    for (const key of data.locked ?? []) if (out[key] && !out[key].lockedBy) out[key].lockedBy = level.rel;
  }
  return { resolved: out, problems };
}

export const settingValue = <T>(root: string, key: string): T => resolveSettings(root)[key].value as T;

/** Change a setting in this repo's own file, unless a level above locked it. */
export function setSetting(root: string, key: string, value: unknown): string {
  if (!(key in DEFAULTS)) throw new Error(`'${key}' isn't a setting. Settings: ${Object.keys(DEFAULTS).join(", ")}`);
  const current = resolveSettings(root)[key];
  const area = areaOf(root);
  const own = area ? area.rel : "this repo";
  if (current.lockedBy && current.lockedBy !== own) throw new Error(`${key} is locked by ${current.lockedBy}, so it can't be changed here`);
  const path = area ? areaSettingsFile(area) : join(root, SETTINGS_FILE);
  const doc = parseDocument(store().exists(path) ? store().read(path) : "# nikOS settings. Departments and groups that plan against this repo inherit them.\nformat_version: 1\n");
  doc.setIn(key.split("."), value);
  const text = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  if (!check(parse(text))) {
    const e = check.errors![0];
    throw new Error(`${key}: ${e.message}${(e.params as any)?.allowedValues ? ` (${(e.params as any).allowedValues.join(", ")})` : ""}`);
  }
  store().write(path, text);
  return path;
}

/** The settings as lines: each value, where it came from, and whether it's locked. */
export function formatSettings(r: Resolved): string {
  return Object.entries(r)
    .map(([key, s]) => `${key}: ${JSON.stringify(s.value)}  (${s.from}${s.lockedBy ? `; locked by ${s.lockedBy}` : ""})`)
    .join("\n");
}
