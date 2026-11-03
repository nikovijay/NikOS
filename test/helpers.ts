import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const exampleDir = join(__dirname, "../examples/hello-todo");

/** Copy the hello-todo example to a temp dir and return its intent/ path. */
export function copyExample(): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-"));
  cpSync(exampleDir, dir, { recursive: true });
  return join(dir, "intent");
}

export function edit(path: string, fn: (s: string) => string): void {
  writeFileSync(path, fn(readFileSync(path, "utf8")));
}
