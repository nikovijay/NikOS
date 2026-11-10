// The planning/ folder: bet cards, key results and the planning context. Every write in
// the pack (command line and dashboard) goes through here, so both get the same checks.
import Ajv2020Module, { type ErrorObject } from "ajv/dist/2020.js";
const Ajv2020 = (Ajv2020Module as any).default ?? Ajv2020Module;
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, parse } from "yaml";
import { parseFrontMatter } from "../lib/frontmatter.js";
import { walk } from "../lib/project.js";
import { store } from "../lib/store.js";

const here = dirname(fileURLToPath(import.meta.url));
// Works from src/ (tests) and dist/ (published): schemas sit at the package root.
const schemaDir = [join(here, "../../schemas/planning"), join(here, "../schemas/planning")].find((d) => existsSync(d))!;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const schema = (name: string) => ajv.compile(JSON.parse(readFileSync(join(schemaDir, name), "utf8")));
export const checkBet = schema("bet.schema.json");
export const checkKr = schema("kr.schema.json");

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const today = () => new Date().toISOString().slice(0, 10);

/** The levels of a planning repo, by the folder under planning/ that holds them. */
export const AREA_FOLDERS = { departments: "department", groups: "group", teams: "team" } as const;
export type AreaLevel = "company" | (typeof AREA_FOLDERS)[keyof typeof AREA_FOLDERS];

export interface Area {
  /** The planning repo's root. */
  repo: string;
  level: AreaLevel;
  /** The area's id: company, a department's or group's id, or a team's key. */
  id: string;
  dir: string;
  /** As people write it: company, departments/finance, groups/payments, teams/WEB. */
  rel: string;
}

/** A planning repo: one per company, with planning/company/ and a folder for each department, group and team. */
export const isPlanRepo = (dir: string) => store().isDir(join(resolve(dir), "planning", "company"));

/** The area a folder is, in a planning repo: planning/company or planning/<departments|groups|teams>/<id>. */
export function areaOf(dir: string): Area | undefined {
  const abs = resolve(dir);
  const parent = dirname(abs);
  if (basename(abs) === "company" && basename(parent) === "planning") {
    const repo = dirname(parent);
    return isPlanRepo(repo) ? { repo, level: "company", id: "company", dir: abs, rel: "company" } : undefined;
  }
  const kind = basename(parent) as keyof typeof AREA_FOLDERS;
  if (!(kind in AREA_FOLDERS) || basename(dirname(parent)) !== "planning") return undefined;
  const repo = dirname(dirname(parent));
  if (!isPlanRepo(repo)) return undefined;
  return { repo, level: AREA_FOLDERS[kind], id: basename(abs), dir: abs, rel: `${kind}/${basename(abs)}` };
}

/** Where file names are shown from: the planning repo's root for an area, else the repo itself. */
export const labelRoot = (root: string) => areaOf(root)?.repo ?? root;

/** The command that lists what's here. */
const STATUS_COMMAND = "nikos plan status";

// An area of a planning repo is laid out like a repo's planning/ folder: plan.yaml, krs/, bets/.
export const paths = (root: string) => {
  const area = areaOf(root);
  const planning = area ? area.dir : join(root, "planning");
  return {
    planning,
    bets: join(planning, "bets"),
    krs: join(planning, "krs"),
    plan: join(planning, "plan.yaml"),
    views: join(planning, "views"),
  };
};

export const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

export function describeErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => {
    const at = e.instancePath.replace(/^\//, "").split("/").join(".") || "(root)";
    if (e.keyword === "additionalProperties") return `${at === "(root)" ? "" : at + ": "}unknown field '${(e.params as any).additionalProperty}'`;
    if (e.keyword === "required") return `${at === "(root)" ? "" : at + ": "}missing required field '${(e.params as any).missingProperty}'`;
    if (e.keyword === "enum") return `${at} must be one of ${(e.params as any).allowedValues.join(", ")}`;
    return `${at} ${e.message}`;
  });
}

/** A file inside planning/, refusing anything that would land outside it. */
export function inside(root: string, ...parts: string[]): string {
  const base = paths(root).planning;
  const path = resolve(base, ...parts);
  if (path !== base && !path.startsWith(base + sep)) throw new Error(`Refusing to write outside planning/: ${parts.join("/")}`);
  return path;
}

export class StaleError extends Error {
  /** The message as given when it was already built (a dry run hands it back), else built from the file. */
  constructor(file: string, message?: string) {
    super(message ?? `${file} changed on disk since it was loaded; reload and try again`);
  }
}

/** Write a planning file. With `expect`, refuse if the file on disk isn't the version that was loaded. */
export function writePlanning(root: string, path: string, text: string, opts: { expect?: string; create?: boolean } = {}): string {
  const rel = relative(labelRoot(root), path).split(sep).join("/");
  if (!path.startsWith(paths(root).planning + sep)) throw new Error(`Refusing to write outside planning/: ${rel}`);
  if (opts.expect !== undefined) {
    const current = store().exists(path) ? hash(store().read(path)) : "";
    if (current !== opts.expect) throw new StaleError(rel);
  }
  try {
    store().write(path, text, { create: opts.create });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${rel} already exists`);
    throw err;
  }
  return rel;
}

/** Refuse when the text on hand isn't the version the caller loaded (expect is its hash). */
export function checkHash(label: string, text: string, expect: string | undefined): void {
  if (expect !== undefined && hash(text) !== expect) throw new StaleError(label);
}

export interface Bet {
  meta: any;
  body: string;
  file: string;
  hash: string;
}
export interface Kr {
  data: any;
  file: string;
  hash: string;
}

const yamlText = (data: unknown, flow: string[] = []) => {
  const doc = new Document(data);
  for (const key of flow) {
    const node = doc.getIn(key.split("."), true) as any;
    if (node && typeof node === "object" && "items" in node) node.flow = true;
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
};

export const betText = (meta: any, body: string) => `---\n${yamlText(meta, ["krs.also", "aligns_to", "dependencies"])}---\n${body}`;
export const krText = (data: any) => yamlText(data, ["aligns_to"]);

const label = (root: string, path: string) => relative(labelRoot(root), path).split(sep).join("/");

export function loadBet(root: string, id: string): Bet {
  const path = join(paths(root).bets, `${id}.md`);
  if (!store().exists(path)) throw new Error(`No bet called '${id}' (${label(root, path)}). See every bet with: ${STATUS_COMMAND}`);
  const text = store().read(path);
  const fm = parseFrontMatter(text);
  if (!fm) throw new Error(`${label(root, path)} is missing its details block: the lines between --- at the top of the file`);
  return { meta: fm.meta, body: fm.body, file: label(root, path), hash: hash(text) };
}

export function loadKr(root: string, id: string): Kr {
  const path = join(paths(root).krs, `${id}.yaml`);
  if (!store().exists(path)) throw new Error(`No key result called '${id}' (${label(root, path)}). See every key result with: ${STATUS_COMMAND}`);
  const text = store().read(path);
  return { data: parse(text), file: label(root, path), hash: hash(text) };
}

export const betIds = (root: string) => walk(paths(root).bets, ".md").map((p) => basename(p, ".md")).sort();
export const krIds = (root: string) => walk(paths(root).krs, ".yaml").map((p) => basename(p, ".yaml")).sort();

export interface PlanningIssue {
  file: string;
  message: string;
  /** Worth fixing, but not a failure: validate still passes. */
  warning?: boolean;
}

/** Check every planning file against its schema and the links between them. */
export function validatePlanning(root: string): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  // An area's plan.yaml is checked with the rest of its planning repo (src/plan/repo.ts), and its bets'
  // key results may be in any area of the company, so links are checked there, not here.
  for (const id of krIds(root)) {
    let kr: Kr;
    try {
      kr = loadKr(root, id);
    } catch (err) {
      issues.push({ file: label(root, join(paths(root).krs, `${id}.yaml`)), message: (err as Error).message.split("\n")[0] });
      continue;
    }
    if (!checkKr(kr.data)) for (const m of describeErrors(checkKr.errors)) issues.push({ file: kr.file, message: m });
    else if (kr.data.id !== id) issues.push({ file: kr.file, message: `id '${kr.data.id}' doesn't match the file name` });
  }
  for (const id of betIds(root)) {
    let bet: Bet;
    try {
      bet = loadBet(root, id);
    } catch (err) {
      issues.push({ file: label(root, join(paths(root).bets, `${id}.md`)), message: (err as Error).message.split("\n")[0] });
      continue;
    }
    if (!checkBet(bet.meta)) {
      for (const m of describeErrors(checkBet.errors)) issues.push({ file: bet.file, message: m });
      continue;
    }
    if (bet.meta.id !== id) issues.push({ file: bet.file, message: `id '${bet.meta.id}' doesn't match the file name` });
  }
  return issues;
}
