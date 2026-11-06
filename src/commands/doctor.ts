// `nikos doctor`: is this repo set up the way nikOS works best? Each check says what it found
// and, when something's missing, the next thing to do, in words an agent can act on.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findIntentDir } from "../lib/project.js";
import { resolveSettings } from "../lib/settings.js";
import { store } from "../lib/store.js";
import { perStory } from "../lib/state-files.js";
import { detectStack } from "../verify/detect.js";
import { checkStale, readLock, upstreamEntries } from "../planning/upstream.js";
import { validate } from "./validate.js";

export interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  found: string;
  /** What to do about it, when it isn't ok. */
  next?: string;
}

const CI_FILES = [".github/workflows/nikos.yml", ".gitlab/ci/nikos.yml"];
const RUNNER_FILES = ["cucumber.mjs", "cucumber.js", "behave.ini"];

/** The repo's CODEOWNERS file, wherever GitHub or GitLab looks for it. */
const codeowners = (root: string) => ["CODEOWNERS", ".github/CODEOWNERS", ".gitlab/CODEOWNERS", "docs/CODEOWNERS"].map((f) => join(root, f)).find((f) => existsSync(f));

export function doctor(root: string, opts: { offline?: boolean } = {}): Check[] {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const intent = findIntentDir(root);
  if (!store().exists(join(intent, "storymap.yaml"))) {
    add({ name: "story map", status: "fail", found: "no intent/ folder", next: "Set up nikOS here (nikos init), or map what the repo already does" });
    return checks;
  }
  const v = validate(root);
  add(
    v.errors.length
      ? { name: "story map", status: "fail", found: `${v.errors.length} ${v.errors.length === 1 ? "problem" : "problems"} in intent/`, next: "Run nikos validate and fix what it lists" }
      : { name: "story map", status: v.warnings.length ? "warn" : "ok", found: `${v.stories} stories in ${v.releases} releases${v.warnings.length ? `, ${v.warnings.length} warnings` : ""}`, ...(v.warnings.length ? { next: "Run nikos validate to see the warnings" } : {}) },
  );

  const runner = RUNNER_FILES.find((f) => existsSync(join(root, f)));
  add(
    runner
      ? { name: "scenario runner", status: "ok", found: runner }
      : { name: "scenario runner", status: "fail", found: detectStack(root) ? "no Cucumber runner yet" : "no runner, and the stack isn't clear", next: "Set one up with nikos verify setup, so stories can be proved done" },
  );

  const ci = CI_FILES.find((f) => existsSync(join(root, f)));
  add(ci ? { name: "CI", status: "ok", found: ci } : { name: "CI", status: "warn", found: "scenarios don't run on pull or merge requests", next: "Add the pipeline with nikos ci setup" });

  const settings = resolveSettings(root);
  const policy = settings["approval.policy"];
  const owners = codeowners(root);
  const protectedApprovals = owners && /approvals(\.yaml|\/)/.test(readFileSync(owners, "utf8"));
  if (policy.value === "off") add({ name: "approvals", status: "ok", found: `off (${policy.from})` });
  else if (protectedApprovals) add({ name: "approvals", status: "ok", found: `${policy.value} (${policy.from}); intent/approvals${perStory(intent) ? "/" : ".yaml"} needs a CODEOWNERS review` });
  else
    add({
      name: "approvals",
      status: policy.value === "required-for-release" ? "warn" : "ok",
      found: `${policy.value} (${policy.from}); anyone can add an approval`,
      ...(policy.value === "required-for-release" ? { next: "Protect intent/approvals.yaml with a CODEOWNERS rule and branch protection, so an approval needs the right reviewer" } : {}),
    });

  const tracker = settings["tracker.system"];
  if (tracker.value !== "none") {
    const mapped = Object.keys(settings["tracker.statuses"].value as object).length;
    add(
      mapped
        ? { name: "tracker", status: "ok", found: `${tracker.value} (${tracker.from}), ${mapped} statuses mapped` }
        : { name: "tracker", status: "warn", found: `${tracker.value}, but no statuses mapped`, next: "Connect the tracker: map its statuses to nikOS's" },
    );
  }

  let upstreams: string[] = [];
  try {
    upstreams = upstreamEntries(root).map((e) => e.repo);
  } catch (err) {
    add({ name: "upstream plans", status: "fail", found: (err as Error).message, next: "Fix planning/upstream.yaml" });
  }
  if (upstreams.length) {
    const lock = readLock(root);
    const missing = upstreams.filter((r) => !lock.some((l) => l.repo === r));
    if (missing.length) add({ name: "upstream plans", status: "warn", found: `${missing.join(", ")} not synced yet`, next: "Run nikos planning sync" });
    else if (!opts.offline) {
      const stale = checkStale(root);
      const problems = [...stale.stale.map((s) => `${s.repo} has moved on`), ...stale.unresolved.map((u) => `${u.repo} unreachable`)];
      add(problems.length ? { name: "upstream plans", status: "warn", found: problems.join("; "), next: "Run nikos planning sync" } : { name: "upstream plans", status: "ok", found: `${lock.length} synced and current` });
    } else add({ name: "upstream plans", status: "ok", found: `${lock.length} synced` });
  }
  return checks;
}

export function runDoctor(args: string[]): number {
  const i = args.indexOf("--dir");
  const root = i >= 0 ? args[i + 1] : process.cwd();
  try {
    const checks = doctor(root, { offline: args.includes("--offline") });
    const mark = { ok: "✓", warn: "!", fail: "✗" };
    for (const c of checks) console.log(`${mark[c.status]} ${c.name}: ${c.found}${c.next ? `\n    → ${c.next}` : ""}`);
    return checks.some((c) => c.status === "fail") ? 1 : 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
