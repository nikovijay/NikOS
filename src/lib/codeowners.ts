// CODEOWNERS: the file GitHub or GitLab reads, and the rules that name a story map's folder.
// migrate maps moves intent/ to maps/<key>/, so those rules move with it. Other lines stay as they are.
import { join } from "node:path";
import { store } from "./store.js";

export const CODEOWNERS_FILES = ["CODEOWNERS", ".github/CODEOWNERS", ".gitlab/CODEOWNERS", "docs/CODEOWNERS"];

/** The repo's CODEOWNERS file, wherever GitHub or GitLab looks for it, or undefined. */
export function codeownersFile(root: string): string | undefined {
  return CODEOWNERS_FILES.map((f) => join(root, f)).find((f) => store().exists(f));
}

/** CODEOWNERS text with each rule under intent/ moved to maps/<key>/. Returns the text and the lines that changed. */
export function moveCodeowners(text: string, key: string): { text: string; changed: string[] } {
  const changed: string[] = [];
  const out = text.split("\n").map((line) => {
    if (!/^\/?intent\//.test(line)) return line;
    const next = line.replace(/^(\/?)intent\//, `$1maps/${key}/`);
    changed.push(next);
    return next;
  });
  return { text: out.join("\n"), changed };
}
