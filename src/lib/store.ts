// Where nikOS reads and writes a repo's files: intent/, planning/ and approvals. The CLI uses
// the disk. Another tool can load a repo's files into a MemoryStore (from GitHub, GitLab or
// anywhere), run nikOS's commands against it, and take the changed files back to commit.
// Running scenarios, cloning upstream plans and package assets (schemas, templates) always use
// the disk: they need real files.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export interface Store {
  read(path: string): string;
  exists(path: string): boolean;
  isDir(path: string): boolean;
  /** The names in a folder, as readdir gives them. */
  list(dir: string): string[];
  /** Write a file, making its folders. With create, refuse to replace one that exists. */
  write(path: string, text: string, opts?: { create?: boolean }): void;
  append(path: string, text: string): void;
}

export const diskStore: Store = {
  read: (path) => readFileSync(path, "utf8"),
  exists: (path) => existsSync(path),
  isDir: (path) => existsSync(path) && statSync(path).isDirectory(),
  list: (dir) => readdirSync(dir),
  write: (path, text, opts) => {
    mkdirSync(dirname(path), { recursive: true });
    // "wx" also guards against a file appearing between a check and the write.
    writeFileSync(path, text, opts?.create ? { flag: "wx" } : undefined);
  },
  append: (path, text) => appendFileSync(path, text),
};

/** A repo held in memory: files by absolute path. changes() lists what nikOS wrote. */
export class MemoryStore implements Store {
  private files = new Map<string, string>();
  private changed = new Set<string>();

  /** files: paths relative to root (e.g. "intent/storymap.yaml") and their text. */
  constructor(files: Record<string, string> = {}, readonly root = resolve(sep, "repo")) {
    for (const [path, text] of Object.entries(files)) this.files.set(resolve(root, path), text);
  }

  read(path: string): string {
    const text = this.files.get(resolve(path));
    if (text === undefined) throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: "ENOENT" });
    return text;
  }
  exists(path: string): boolean {
    return this.files.has(resolve(path)) || this.isDir(path);
  }
  isDir(path: string): boolean {
    const prefix = resolve(path) + sep;
    for (const p of this.files.keys()) if (p.startsWith(prefix)) return true;
    return false;
  }
  list(dir: string): string[] {
    const prefix = resolve(dir) + sep;
    const names = new Set<string>();
    for (const p of this.files.keys()) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split(sep)[0]);
    return [...names].sort();
  }
  write(path: string, text: string, opts?: { create?: boolean }): void {
    const abs = resolve(path);
    if (opts?.create && this.files.has(abs)) throw Object.assign(new Error(`EEXIST: file already exists, open '${path}'`), { code: "EEXIST" });
    this.files.set(abs, text);
    this.changed.add(abs);
  }
  append(path: string, text: string): void {
    this.write(path, (this.files.get(resolve(path)) ?? "") + text);
  }
  /** The files nikOS wrote, relative to root, with their new text. */
  changes(): { path: string; text: string }[] {
    return [...this.changed].sort().map((abs) => ({ path: abs.slice(this.root.length + 1).split(sep).join("/"), text: this.files.get(abs)! }));
  }
}

let current: Store = diskStore;

/** The store nikOS reads and writes through right now. */
export const store = (): Store => current;

/** Run fn with nikOS reading and writing through another store, e.g. a MemoryStore. */
export function withStore<T>(s: Store, fn: () => T): T {
  const previous = current;
  current = s;
  try {
    return fn();
  } finally {
    current = previous;
  }
}
