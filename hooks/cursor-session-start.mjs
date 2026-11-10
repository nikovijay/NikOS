#!/usr/bin/env node
// Cursor's sessionStart hook for nikOS: in a repo with a story map, add where things stand and
// what to suggest next to the conversation. Cursor sends JSON on stdin (workspace_roots, among
// others) and reads JSON from stdout, so the output is { "additional_context": "..." }, or {}
// when there's nothing to add. Repos without a story map never run nikos at all.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  // No input, or not JSON: fall back to the working directory.
}
const root = (Array.isArray(input.workspace_roots) && input.workspace_roots[0]) || process.cwd();
// A story map is any maps/<key>/storymap.yaml.
const mapsDir = join(root, "maps");
const hasMap = existsSync(mapsDir) && readdirSync(mapsDir).some((d) => existsSync(join(mapsDir, d, "storymap.yaml")));
let context = "";
if (hasMap) {
  // NIKOS_CLI points at a local build, for testing this script.
  const [cmd, args] = process.env.NIKOS_CLI ? [process.execPath, [process.env.NIKOS_CLI]] : ["npx", ["-y", "nikos@latest"]];
  const r = spawnSync(cmd, [...args, "suggest", "--brief", "--dir", root], { encoding: "utf8", timeout: 25000 });
  if (r.status === 0) context = r.stdout.trim();
}
process.stdout.write(JSON.stringify(context ? { additional_context: context } : {}) + "\n");
