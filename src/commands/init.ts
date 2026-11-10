import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walk } from "../lib/project.js";
import { storyPrefix } from "../lib/maps.js";
import { diskStore, store, withStore } from "../lib/store.js";
import { validate, formatResult, type ValidationResult } from "./validate.js";
import { writeMapSummary } from "../lib/map-summary.js";
import { isPlanRepo } from "../planning/model.js";
import { oldLayoutProblem } from "../plan/repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = [join(here, "../../templates"), join(here, "../templates")].find((d) => existsSync(d))!;
/** The story map's folder files, written under maps/<key>/. */
const mapTemplateDir = join(templatesDir, "map");
/** The repo's own files, written at its root: the constitution and the decisions log. */
const rootTemplateDir = join(templatesDir, "root");

export interface InitOptions {
  name?: string;
  key?: string;
}

export interface InitResult {
  /** The story map's folder, maps/<key>. */
  mapDir: string;
  /** Each file written, relative to the repo root. */
  created: string[];
  skipped: string[];
  validation: ValidationResult;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

/** "Hello Todo" → "HT", "nikos" → "NIK". */
export function keyFor(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "P").slice(0, 3);
  const clean = key.toUpperCase().replace(/^[0-9]+/, "");
  return (clean || "P").slice(0, 6);
}

/**
 * Set up a repo's story map: maps/<key>/ with its storymap, state, first story and plans, and the
 * constitution and decisions log at the root. Files that already exist are skipped, not overwritten.
 */
export function init(root: string, opts: InitOptions = {}): InitResult {
  const name = opts.name ?? basename(resolve(root));
  const key = (opts.key ?? keyFor(name)).toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,9}$/.test(key)) throw new Error(`'${key}' isn't a valid project key (letters and digits, starting with a letter)`);
  if (isPlanRepo(root)) throw new Error("This is the company's planning repo. Story maps live in code repos: run nikos init there.");
  const old = oldLayoutProblem(root);
  if (old) throw new Error(old);
  if (store().isDir(join(root, "intent"))) throw new Error("this repo has intent/: move intent/ to maps/<key>/ by hand, as the release notes describe");
  const mapDir = join(root, "maps", key.toLowerCase());
  // The starter story's id carries the same label map new gives a story: the map's owner, if it has one.
  const first_id = `${storyPrefix({ root, dir: mapDir, id: key.toLowerCase() }, key)}-1`;
  const values: Record<string, string> = { project_name: name, project_slug: slugify(name), key, first_id };
  if (store().exists(join(mapDir, "storymap.yaml"))) throw new Error(`maps/${key.toLowerCase()}/ already exists`);
  const created: string[] = [];
  const skipped: string[] = [];

  // The templates ship with nikOS, so they're always listed and read from disk.
  const copy = (templates: string, into: string, prefix: string) => {
    for (const src of withStore(diskStore, () => walk(templates))) {
      const rel = relative(templates, src);
      const dest = join(into, rel);
      if (store().exists(dest)) {
        skipped.push(prefix + rel);
        continue;
      }
      const text = readFileSync(src, "utf8").replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? `{{${k}}}`);
      // create guards against a race where the file appears between the check and the write.
      store().write(dest, text, { create: true });
      created.push(prefix + rel);
    }
  };
  copy(mapTemplateDir, mapDir, `maps/${key.toLowerCase()}/`);
  copy(rootTemplateDir, root, "");
  // The map's delivery.yaml says what its files say, so validate finds it current from the start.
  writeMapSummary(root, mapDir);
  created.push(`maps/${key.toLowerCase()}/delivery.yaml`);
  return { mapDir, created, skipped, validation: validate(mapDir) };
}

const EXAMPLES: Record<string, string> = { name: '"Hello Todo"', key: "HT", dir: "." };

export function runInit(args: string[]): number {
  const opt = (n: string) => {
    const i = args.indexOf(`--${n}`);
    if (i < 0) return undefined;
    const value = args[i + 1];
    // Without this, a bare --name falls back to the folder name and the key changes silently.
    if (value === undefined || value.startsWith("--") || !value.trim()) throw new Error(`--${n} needs a value, e.g. --${n} ${EXAMPLES[n] ?? "<value>"}`);
    return value;
  };
  try {
    const r = init(opt("dir") ?? process.cwd(), { name: opt("name"), key: opt("key") });
    if (r.skipped.length === 0) {
      console.log(`Created maps/${basename(r.mapDir)}/ (${r.created.length} files)`);
    } else {
      if (r.created.length) console.log(`Created:\n${r.created.map((f) => `  + ${f}`).join("\n")}`);
      console.log(`Skipped (already there):\n${r.skipped.map((f) => `  = ${f}`).join("\n")}`);
    }
    console.log(formatResult(r.validation));
    if (r.validation.errors.length === 0 && r.skipped.length === 0) {
      console.log(`\nNext: fill in constitution.md, then write your first story in maps/${basename(r.mapDir)}/features/.`);
    }
    return r.validation.errors.length ? 1 : 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
