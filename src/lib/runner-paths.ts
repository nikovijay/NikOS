// The scenario runner's config names the folders its stories live in. migrate maps moves
// intent/features to maps/<key>/features, so the paths line moves with it. Only the forms
// `nikos verify setup` writes are rewritten. Any other form is reported, so nothing is clobbered.
//
// behave takes folders, not globs, and it fails on a folder that doesn't exist, so behave.ini
// gets the one folder the migration creates. Cucumber takes globs, so its line gets one more.

export interface RunnerRewrite {
  /** The new file text, when a line changed. */
  text?: string;
  /** What to do by hand, when the form isn't one this knows. */
  hint?: string;
}

const LEGACY_FEATURES_GLOB = "intent/features/**/*.feature";

export function rewriteRunnerPaths(file: string, text: string, key: string): RunnerRewrite {
  const folder = `maps/${key}/features`;
  if (file === "behave.ini") {
    if (!text.includes("intent/features")) return {};
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.trim() === "paths = intent/features");
    if (at < 0) return { hint: `Runner config ${file} lists paths the migration doesn't know: add ${folder} by hand.` };
    // A file that already lists the new folder just loses the old one.
    if (lines.some((l) => l.trim() === `paths = ${folder}`)) return { text: lines.filter((_, i) => i !== at).join("\n") };
    lines[at] = `paths = ${folder}`;
    return { text: lines.join("\n") };
  }
  // cucumber.mjs and cucumber.js: one paths array.
  if (!text.includes(LEGACY_FEATURES_GLOB)) return {};
  const line = text.split("\n").find((l) => /^\s*paths:\s*\[/.test(l));
  const next = `maps/${key}/features/**/*.feature`;
  if (!line) return { hint: `Runner config ${file} lists paths the migration doesn't know: add "${next}" by hand.` };
  const entry = `"${LEGACY_FEATURES_GLOB}"`;
  const hasMaps = line.includes(`"${next}"`) || line.includes(`"maps/*/features/**/*.feature"`);
  let swapped: string;
  if (!hasMaps) swapped = line.replace(entry, `"${next}"`);
  else swapped = line.includes(`, ${entry}`) ? line.replace(`, ${entry}`, "") : line.replace(`${entry}, `, "").replace(entry, "");
  if (swapped === line) return { hint: `Runner config ${file} lists paths the migration doesn't know: add "${next}" by hand.` };
  return { text: text.replace(line, swapped) };
}
