// Settings in nikos.settings.yaml, at a repo's root. A company sets them once; departments, groups
// and teams inherit them through planning/upstream.yaml (synced into .nikos/upstream/), and can
// change any value the levels above haven't locked. Each value remembers where it came from.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module from "ajv/dist/2020.js";
import { parse, parseDocument } from "yaml";
import { store } from "./store.js";
import { REPO_PATH } from "./bets.js";

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

/** A repo's own settings file, parsed and checked. */
export function readSettings(root: string): { values: Record<string, unknown>; locked: string[] } {
  const path = join(root, SETTINGS_FILE);
  if (!store().exists(path)) return { values: {}, locked: [] };
  const data = parse(store().read(path)) ?? {};
  if (!check(data)) {
    const e = check.errors![0];
    throw new Error(`${SETTINGS_FILE}: ${e.instancePath.replace(/^\//, "").replace(/\//g, ".") || "(root)"} ${e.message}`);
  }
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
 * The settings that apply to a repo: defaults, then each level above it from the top down
 * (through the synced copies in .nikos/upstream/), then the repo's own. A level can't change a
 * value a level above it locked.
 */
export function resolveSettings(root: string): Resolved {
  const cache = join(resolve(root), ".nikos", "upstream");
  const out: Resolved = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, { value: v, from: "default" }]));
  const visiting = new Set<string>();
  const apply = (dir: string, name: string) => {
    if (visiting.has(dir)) return; // a loop of upstreams: each level counts once
    visiting.add(dir);
    for (const up of upstreamsOf(dir)) {
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
  return out;
}

export const settingValue = <T>(root: string, key: string): T => resolveSettings(root)[key].value as T;

/** Change a setting in this repo's own file, unless a level above locked it. */
export function setSetting(root: string, key: string, value: unknown): string {
  if (!(key in DEFAULTS)) throw new Error(`'${key}' isn't a setting. Settings: ${Object.keys(DEFAULTS).join(", ")}`);
  const current = resolveSettings(root)[key];
  if (current.lockedBy && current.lockedBy !== "this repo") throw new Error(`${key} is locked by ${current.lockedBy}, so it can't be changed here`);
  const path = join(root, SETTINGS_FILE);
  const doc = parseDocument(store().exists(path) ? store().read(path) : "# nikOS settings. Departments, groups and teams that plan against this repo inherit them.\nformat_version: 1\n");
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
