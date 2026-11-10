import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const exampleDir = join(__dirname, "../examples/hello-todo");

/** Copy the hello-todo example to a temp dir and return its map folder, maps/ht. */
export function copyExample(): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-"));
  cpSync(exampleDir, dir, { recursive: true });
  return join(dir, "maps", "ht");
}

/** The repo root of a map folder (maps/<key>): the folder two levels up. */
export function rootOf(mapDir: string): string {
  return dirname(dirname(mapDir));
}

export function edit(path: string, fn: (s: string) => string): void {
  writeFileSync(path, fn(readFileSync(path, "utf8")));
}
