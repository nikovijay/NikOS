// Settings in nikos.settings.yaml, at a repo's root. In a planning repo the company sets them once and
// each area inherits them down the folders, changing any value the levels above haven't locked. A code
// repo keeps its own file and inherits nothing. Each value remembers where it came from.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import { parse, parseDocument } from "yaml";
import { store } from "./store.js";
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

/** One level of settings, parsed and checked: the label a value from it carries, and its data. */
export interface SettingsLevel {
  label: string;
  data: any;
}

/** A value a level tried to set, which a level above had locked. It is ignored. */
export interface IgnoredSetting {
  key: string;
  level: string;
  lockedBy: string;
}

/**
 * Layer settings levels over the defaults, top to bottom. A level changes only what the levels above
 * haven't locked, and its own locked list locks keys for the levels below. A value a level tries to
 * change and can't is returned as ignored. Planning areas and code repos both layer this way.
 */
export function layerSettings(levels: SettingsLevel[]): { resolved: Resolved; ignored: IgnoredSetting[] } {
  const out: Resolved = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, { value: v, from: "default" }]));
  const ignored: IgnoredSetting[] = [];
  for (const level of levels) {
    for (const [key, value] of Object.entries(flatten(level.data))) {
      if (out[key].lockedBy) ignored.push({ key, level: level.label, lockedBy: out[key].lockedBy! });
      else out[key] = { value, from: level.label };
    }
    for (const key of level.data?.locked ?? []) if (out[key] && !out[key].lockedBy) out[key].lockedBy = level.label;
  }
  return { resolved: out, ignored };
}

const formatIgnored = (i: IgnoredSetting) => `${i.key} from ${i.level} is ignored: ${i.lockedBy} locks it`;

/**
 * The settings that apply to a repo. In a planning repo that's its area's chain (areaSettings). A code
 * repo's own nikos.settings.yaml layers over the defaults the same way.
 */
export function resolveSettings(root: string): Resolved {
  return resolveSettingsDetailed(root).resolved;
}

/** resolveSettings, with the problems found in the levels (a settings file that doesn't read, or a value a level above locked). */
export function resolveSettingsDetailed(root: string): { resolved: Resolved; problems: string[] } {
  const area = areaOf(root);
  if (area) return areaSettings(area);
  const path = join(root, SETTINGS_FILE);
  const levels: SettingsLevel[] = [];
  if (store().exists(path)) {
    const text = store().read(path);
    const bad = checkSettingsText(text);
    if (bad) throw new Error(bad);
    levels.push({ label: "this repo", data: parse(text) ?? {} });
  }
  const { resolved, ignored } = layerSettings(levels);
  return { resolved, problems: ignored.map(formatIgnored) };
}

/** An area's own settings file: the company's is nikos.settings.yaml at the root, any other area's is its settings.yaml. */
export const areaSettingsFile = (area: Area) => (area.level === "company" ? join(area.repo, SETTINGS_FILE) : join(area.dir, "settings.yaml"));

/**
 * The settings for an area of a planning repo: the company's, then each level down the folders to
 * this one. Each level changes what nobody above it locked. See docs/rfcs/plan-and-spec.md, rule 6.
 */
function areaSettings(area: Area): { resolved: Resolved; problems: string[] } {
  const problems: string[] = [];
  const levels: SettingsLevel[] = [];
  for (const level of chainOf(area)) {
    const path = areaSettingsFile(level);
    if (!store().exists(path)) continue;
    const text = store().read(path);
    const bad = checkSettingsText(text);
    if (bad) {
      problems.push(`${level.rel}'s settings are skipped: ${bad.replace(SETTINGS_FILE, relative(area.repo, path))}`);
      continue;
    }
    levels.push({ label: level.rel, data: parse(text) ?? {} });
  }
  const { resolved, ignored } = layerSettings(levels);
  return { resolved, problems: [...problems, ...ignored.map(formatIgnored)] };
}

/** Change a setting in this repo's own file, unless a level above locked it. */
export function setSetting(root: string, key: string, value: unknown): string {
  if (!(key in DEFAULTS)) throw new Error(`'${key}' isn't a setting. Settings: ${Object.keys(DEFAULTS).join(", ")}`);
  const current = resolveSettings(root)[key];
  const area = areaOf(root);
  const own = area ? area.rel : "this repo";
  if (current.lockedBy && current.lockedBy !== own) throw new Error(`${key} is locked by ${current.lockedBy}, so it can't be changed here`);
  const path = area ? areaSettingsFile(area) : join(root, SETTINGS_FILE);
  const doc = parseDocument(store().exists(path) ? store().read(path) : "# nikOS settings for this repo.\nformat_version: 1\n");
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
