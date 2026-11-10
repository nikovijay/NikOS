// `nikos apply <file>`: the changes an editable planning export queued, applied to this repo. The
// file holds operations and nothing else. Each one goes through the same write path as the
// dashboard (runOps), the repo is checked before and after, and the changes land on a new nikos
// branch. Nothing is committed or pushed unless it's asked for: --commit, --pr, or a typed y.
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { hostOf, asLine, requestArgv, runForge, toolFor } from "../lib/forge.js";
import { branchExists, commitPaths, currentBranch, firstLine, gitIn, headOf, isGit, nikosPaths, pushBranch, realRun, baseBranch, statusOf, switchNewBranch, unrelatedDirty, type Runner } from "../lib/git.js";
import { schemaProblems } from "../lib/schema.js";
import { store } from "../lib/store.js";
import { levelOf } from "./levels.js";
import { today } from "./model.js";
import { runOps, type Op } from "./ops.js";

export interface ApplyOptions {
  /** The repo to apply to. Defaults to the working directory. */
  dir?: string;
  /** Commit the changed files on the new branch. */
  commit?: boolean;
  /** Commit, push the branch and open the pull or merge request, after a second confirm. */
  pr?: boolean;
  /** Runs git and the forge tools. Tests pass a runner that records the calls. */
  run?: Runner;
  /** Ask a yes or no question. Only asked when interactive is on. */
  ask?: (question: string) => Promise<boolean>;
  /** A terminal to ask in, and no CI. Off in tests and in scripts. */
  interactive?: boolean;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

/** Ask a yes or no question on the terminal. Anything but y or yes is no. */
export async function askYes(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/** A new branch name for the change: nikos/plan-<level>-<date>, with -2, -3 when it's taken. */
function branchName(root: string, level: string, run: Runner): string {
  const stamp = today();
  let name = `nikos/plan-${level}-${stamp}`;
  for (let n = 2; branchExists(root, name, run); n++) name = `nikos/plan-${level}-${stamp}-${n}`;
  return name;
}

/** One operation as a short line for the report: its name and the ids it targets. */
const describe = (op: Op) => [op.op, ...Object.values(op.target ?? {})].join(" ");

/**
 * Apply a change file to a repo. Returns the exit code: 0 when every operation applied, 2 when some
 * were skipped (the rest applied), and 1 when the file, the repo or the checks refuse, or a commit
 * or request didn't finish. Nothing is written on 1, except that a commit or request that fails
 * leaves its changes on the branch.
 */
export async function applyChanges(file: string, opts: ApplyOptions = {}): Promise<number> {
  const outRaw = opts.out ?? ((line: string) => console.log(line));
  const errRaw = opts.err ?? ((line: string) => console.error(line));
  const root = resolve(opts.dir ?? process.cwd());
  const run = opts.run ?? realRun;
  const interactive = opts.interactive ?? (!!process.stdin.isTTY && !process.env.CI);
  const ask = opts.ask ?? askYes;
  // Every line is printed as plain text: control characters in a file from someone else are shown as ?.
  const clean = (line: string) => line.replace(/[\u0000-\u001f\u007f]/g, "?");
  const out = (line: string) => outRaw(clean(line));
  const err = (line: string) => errRaw(clean(line));
  const refuse = (...lines: string[]) => {
    for (const line of lines) err(`✗ ${line}`);
    return 1;
  };

  let doc: any;
  try {
    doc = JSON.parse(readFileSync(resolve(file), "utf8"));
  } catch (e) {
    return refuse(`Can't read ${file} as JSON: ${firstLine((e as Error).message)}`);
  }
  const problems = schemaProblems("planning/changes.schema.json", doc);
  if (problems.length) return refuse(`${file} isn't a nikOS change file:`, ...problems.map((p) => `  ${p}`));
  const level = levelOf(root);
  if (doc.plan.level !== level) return refuse(`This file is for a ${doc.plan.level} plan; this repo is ${level ? `a ${level} plan` : "not a plan (no planning/plan.yaml)"}`);
  if (!isGit(root, run)) return refuse("nikos apply needs a git repo: the changes go on a branch");
  const own = nikosPaths(root);
  if (own.length && statusOf(root, own, run).length) return refuse("Commit or stash changes in planning/ or maps/ first");

  const head = headOf(root);
  if (doc.source.commit && head && doc.source.commit !== head) {
    out(`Exported from ${doc.source.commit.slice(0, 7)}; this repo is at ${head.slice(0, 7)}. Each operation is checked against the current files.`);
  }
  const unrelated = unrelatedDirty(root, run);
  if (unrelated.length) out(`! ${unrelated.length} changed ${unrelated.length === 1 ? "file" : "files"} outside planning/ and maps/ are left alone.`);
  if (doc.made_by) out(`Made by ${doc.made_by} (typed in the export; not checked).`);

  const ops: Op[] = doc.operations.map((o: any) => ({
    op: o.op,
    ...(o.target ? { target: o.target } : {}),
    args: o.args ?? {},
    ...(o.expect ? { expect: o.expect } : {}),
  }));
  if (!ops.length) {
    out("Nothing to apply: the file has no operations.");
    return 0;
  }

  // The dry run: chained, so a second op on a file made against the first one's result still applies.
  const dry = runOps(root, ops, { chain: true });
  const fresh = dry.validation.errors.filter((e) => !dry.baseline.errors.includes(e));
  if (fresh.length) {
    return refuse("Applying these operations would leave planning/ invalid. Nothing was written:", ...fresh.map((e) => `  ${e}`));
  }
  const applied = dry.results.filter((r) => r.ok).length;
  const skipped = dry.results.length - applied;
  if (!applied) {
    out(`Applied 0 of ${ops.length} operations`);
    for (const r of dry.results) out(`  skip  ${describe(ops[r.index])}: ${skipReason(r)}`);
    return 2;
  }

  const name = branchName(root, level!, run);
  const from = currentBranch(root, run) ?? "HEAD";
  const made = switchNewBranch(root, name, run);
  if (!made.ok) return refuse(`Couldn't create a branch: ${made.error}`);
  out(`Branch ${name} (from ${from})`);

  for (const [rel, text] of dry.changes) store().write(join(root, rel), text);
  for (const rel of dry.removed) store().remove(join(root, rel));

  out(`Applied ${applied} of ${ops.length} operations`);
  dry.results.forEach((r) => {
    if (r.ok) out(`  ok    ${describe(ops[r.index])}`);
    else out(`  skip  ${describe(ops[r.index])}: ${skipReason(r)}`);
  });
  out("Validation: ok");
  if (dry.baseline.errors.length) out(`! ${dry.baseline.errors.length} existing ${dry.baseline.errors.length === 1 ? "problem" : "problems"} in planning/ ${dry.baseline.errors.length === 1 ? "was" : "were"} left as ${dry.baseline.errors.length === 1 ? "it is" : "they are"}.`);
  const changed = [...dry.changes.keys(), ...dry.removed].sort();
  out(`Changed: ${changed.join(", ")}`);
  // .nikos/ is a rebuildable cache (gitignored): it's written, and never committed.
  const committable = changed.filter((p) => !p.startsWith(".nikos/"));

  let committed = false;
  const wantCommit = !!opts.commit || !!opts.pr || (interactive && (await ask(`Commit these changes on ${name}? [y/N] `)));
  if (wantCommit) {
    const r = commitPaths(root, committable, `nikos: ${level} changes from ${basename(file)}`, run);
    if (!r.ok) return refuse(`Changes are on ${name}; the commit didn't finish: ${r.error}`);
    committed = true;
    out(`Committed ${r.sha!.slice(0, 7)} on ${name}`);
  } else {
    out("Not committed. Run with --commit to commit, or commit by hand.");
  }

  let wantPr = !!opts.pr;
  // A request that was asked for but not opened is a failure for a script, not a success.
  let notOpened = false;
  if (!wantPr && committed && interactive) wantPr = await ask("Push the branch and open a pull or merge request? [y/N] ");
  if (wantPr && committed) {
    // --pr asks once more before anything is pushed; a typed y above was the question.
    const confirmed = !opts.pr || (interactive && (await ask(`Push ${name} and open the request now? [y/N] `)));
    const base = baseBranch(root, run) ?? "main";
    const origin = gitIn(root, ["remote", "get-url", "origin"], run).stdout.trim();
    const kind = hostOf(origin);
    const argv = requestArgv(kind, base, name);
    if (!confirmed) {
      notOpened = true;
      out(`Not pushed. To open the request, run: git push -u origin ${name}${argv ? `; then ${asLine(argv)}` : ""}`);
    } else {
      const pushed = pushBranch(root, name, run);
      if (!pushed.ok) return refuse(`Changes are on ${name}; the push didn't finish: ${pushed.error}`);
      if (!argv) out(`Pushed ${name}. This forge isn't one nikOS knows: open the request in its web interface.`);
      else if (!toolFor(kind, run, root)) out(`Pushed ${name}. Copy this command and run it in the repo: ${asLine(argv)}`);
      else {
        const r = runForge(argv, run, root);
        if (!r.ok) return refuse(`Changes are on ${name}; the request didn't open: ${firstLine(r.output)}`);
        out(firstLine(r.output) || `Opened the request for ${name}.`);
      }
    }
  }
  if (notOpened) return 1;
  return skipped ? 2 : 0;
}

/** Why an op was skipped, in the words the report uses. A stale op says which file moved on. */
function skipReason(r: { message: string; skipped?: string }): string {
  if (r.skipped === undefined) return r.message;
  return `${r.skipped.replace(/ changed on disk since it was loaded.*$/, "")} changed since the snapshot was made; export again`;
}

/** `nikos apply <file> [--dir <repo>] [--commit] [--pr]`. */
export async function runApply(args: string[]): Promise<number> {
  let file: string | undefined;
  let dir: string | undefined;
  let commit = false;
  let pr = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dir") dir = args[++i];
    else if (a === "--commit") commit = true;
    else if (a === "--pr") pr = true;
    else if (a.startsWith("--")) {
      console.error(`✗ nikos apply doesn't take ${a}. Usage: nikos apply <file> [--dir <repo>] [--commit] [--pr]`);
      return 1;
    } else file = a;
  }
  if (!file) {
    console.error("✗ Which changes file should it apply? Give its name, for example: nikos apply plan-changes-2026-11-09.nikos.json");
    return 1;
  }
  const interactive = !!process.stdin.isTTY && !process.env.CI;
  return applyChanges(file, { dir, commit, pr, interactive });
}
