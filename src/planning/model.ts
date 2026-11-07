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
export const checkPlan = schema("plan.schema.json");

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const today = () => new Date().toISOString().slice(0, 10);

/** The repo root holding planning/ (and usually intent/): a repo root, or planning/ itself. */
export function findRoot(start: string): string {
  const abs = resolve(start);
  return basename(abs) === "planning" && !store().exists(join(abs, "planning")) ? dirname(abs) : abs;
}

export const paths = (root: string) => ({
  planning: join(root, "planning"),
  bets: join(root, "planning", "bets"),
  krs: join(root, "planning", "krs"),
  plan: join(root, "planning", "plan.yaml"),
  views: join(root, "planning", "views"),
  upstream: join(root, "planning", "upstream.yaml"),
  lock: join(root, "planning", "upstream.lock"),
  cache: join(root, ".nikos", "upstream"),
  intent: join(root, "intent"),
});

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
  constructor(file: string) {
    super(`${file} changed on disk since it was loaded; reload and try again`);
  }
}

/** Write a planning file. With `expect`, refuse if the file on disk isn't the version that was loaded. */
export function writePlanning(root: string, path: string, text: string, opts: { expect?: string; create?: boolean } = {}): string {
  const rel = relative(root, path);
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

export function loadBet(root: string, id: string): Bet {
  const path = join(paths(root).bets, `${id}.md`);
  if (!store().exists(path)) throw new Error(`No bet called '${id}' (planning/bets/${id}.md)`);
  const text = store().read(path);
  const fm = parseFrontMatter(text);
  if (!fm) throw new Error(`planning/bets/${id}.md has no front matter`);
  return { meta: fm.meta, body: fm.body, file: relative(root, path), hash: hash(text) };
}

export function loadKr(root: string, id: string): Kr {
  const path = join(paths(root).krs, `${id}.yaml`);
  if (!store().exists(path)) throw new Error(`No key result called '${id}' (planning/krs/${id}.yaml)`);
  const text = store().read(path);
  return { data: parse(text), file: relative(root, path), hash: hash(text) };
}

export const betIds = (root: string) => walk(paths(root).bets, ".md").map((p) => basename(p, ".md")).sort();
export const krIds = (root: string) => walk(paths(root).krs, ".yaml").map((p) => basename(p, ".yaml")).sort();

export function loadPlan(root: string): any | undefined {
  const p = paths(root).plan;
  return store().exists(p) ? parse(store().read(p)) : undefined;
}

export interface PlanningIssue {
  file: string;
  message: string;
  /** Worth fixing, but not a failure: validate still passes. */
  warning?: boolean;
}

/** Check every planning file against its schema and the links between them. */
export function validatePlanning(root: string): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  const krs = new Set(krIds(root));
  const plan = loadPlan(root);
  if (plan !== undefined && !checkPlan(plan)) for (const m of describeErrors(checkPlan.errors)) issues.push({ file: "planning/plan.yaml", message: m });
  for (const id of krIds(root)) {
    let kr: Kr;
    try {
      kr = loadKr(root, id);
    } catch (err) {
      issues.push({ file: `planning/krs/${id}.yaml`, message: (err as Error).message.split("\n")[0] });
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
      issues.push({ file: `planning/bets/${id}.md`, message: (err as Error).message.split("\n")[0] });
      continue;
    }
    if (!checkBet(bet.meta)) {
      for (const m of describeErrors(checkBet.errors)) issues.push({ file: bet.file, message: m });
      continue;
    }
    if (bet.meta.id !== id) issues.push({ file: bet.file, message: `id '${bet.meta.id}' doesn't match the file name` });
    for (const ref of [bet.meta.krs.primary, ...(bet.meta.krs.also ?? [])].filter(Boolean)) {
      if (!ref.includes("#") && !krs.has(ref)) issues.push({ file: bet.file, message: `links key result '${ref}', which has no planning/krs/${ref}.yaml` });
    }
  }
  return issues;
}
