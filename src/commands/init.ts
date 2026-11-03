import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walk } from "../lib/project.js";
import { validate, formatResult, type ValidationResult } from "./validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = [join(here, "../../templates/intent"), join(here, "../templates/intent")].find((d) => existsSync(d))!;

export interface InitOptions {
  name?: string;
  key?: string;
}

export interface InitResult {
  intentDir: string;
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

export function init(root: string, opts: InitOptions = {}): InitResult {
  const name = opts.name ?? basename(resolve(root));
  const key = (opts.key ?? keyFor(name)).toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,9}$/.test(key)) throw new Error(`'${key}' isn't a valid project key (letters and digits, starting with a letter)`);
  const values: Record<string, string> = { project_name: name, project_slug: slugify(name), key };
  const intentDir = join(root, "intent");
  const created: string[] = [];
  const skipped: string[] = [];

  for (const src of walk(templateDir)) {
    const rel = relative(templateDir, src);
    const dest = join(intentDir, rel);
    if (existsSync(dest)) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    if (rel.endsWith(".gitkeep")) {
      copyFileSync(src, dest);
    } else {
      const text = readFileSync(src, "utf8").replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? `{{${k}}}`);
      // "wx" guards against a race where the file appears between the check and the write.
      writeFileSync(dest, text, { flag: "wx" });
    }
    created.push(rel);
  }
  return { intentDir, created, skipped, validation: validate(intentDir) };
}

export function runInit(args: string[]): number {
  const opt = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  try {
    const r = init(opt("dir") ?? process.cwd(), { name: opt("name"), key: opt("key") });
    if (r.skipped.length === 0) {
      console.log(`Created intent/ (${r.created.length} files)`);
    } else {
      if (r.created.length) console.log(`Created:\n${r.created.map((f) => `  + intent/${f}`).join("\n")}`);
      console.log(`Skipped (already there):\n${r.skipped.map((f) => `  = intent/${f}`).join("\n")}`);
    }
    console.log(formatResult(r.validation));
    if (r.validation.errors.length === 0 && r.skipped.length === 0) {
      console.log("\nNext: fill in intent/constitution.md, then write your first story in intent/features/.");
    }
    return r.validation.errors.length ? 1 : 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
