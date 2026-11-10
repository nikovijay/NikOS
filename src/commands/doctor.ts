// `nikos doctor`: is this repo set up the way nikOS works best? Each check says what it found
// and, when something's missing, the next thing to do, in words an agent can act on.
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parse } from "yaml";
import { keyFor } from "./init.js";
import { count, decisionsPath, isPlanOnly, rel } from "../lib/project.js";
import { resolveSettings } from "../lib/settings.js";
import { store } from "../lib/store.js";
import { detectStack } from "../verify/detect.js";
import { checkStale, readLock, upstreamEntries } from "../planning/upstream.js";
import { betIds, krIds } from "../planning/model.js";
import { planningIssues } from "../planning/levels.js";
import { loadPlan } from "../planning/model.js";
import { downstreamEntries } from "../planning/rollout.js";
import { decisionEntries } from "./decisions.js";
import { staleCliWarning } from "../lib/cli-version.js";
import { validate, validateGroup } from "./validate.js";
import { mapDirs } from "../lib/maps.js";

const TEAM_PLAN_NEXT = "Team plans are going away. Move each key result to the department's plan, or rewrite it as a bet aimed at a department key result (krs: <department repo>#<kr-id>). Nothing is deleted.";
/** The plan's level, or undefined when planning/plan.yaml doesn't parse: the file's own checks say so, and the rest of doctor still runs. */
// The level in planning/plan.yaml only.
const planLevel = (root: string) => {
  try {
    return loadPlan(root)?.level;
  } catch {
    return undefined;
  }
};
import { read } from "../lib/project.js";

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
  const planOnly = isPlanOnly(root);
  const maps = mapDirs(root).length;
  const oldLayout = store().isDir(join(root, "intent"));
  // A repo with maps/ gets the plan checks only when it has a planning/ folder to check.
  if (planOnly || (maps && store().isDir(join(root, "planning")))) planChecks(root, add);
  if (oldLayout) {
    // A repo that still keeps its story map in intent/ can't be checked until it moves.
    add({ name: "story map", status: "fail", found: "this repo keeps its story map in intent/, the old layout", next: "Run nikos migrate maps to move it into maps/<key>/, then commit the result" });
  } else if (maps) {
    const v = validateGroup(root);
    const runner = RUNNER_FILES.find((f) => existsSync(join(root, f)));
    add(
      runner
        ? runsFolder(root, runner, "maps/")
          ? { name: "scenario runner", status: "ok", found: runner }
          : { name: "scenario runner", status: "warn", found: `${runner} doesn't list the story's features folder`, next: "Your runner config does not list the story's features folder. Add it, or run nikos verify setup on a fresh config." }
        : { name: "scenario runner", status: "fail", found: detectStack(root) ? "no Cucumber runner yet (it runs each story's scenarios)" : "no Cucumber runner yet, and nikOS can't tell which language this project uses", next: "Run nikos verify setup. Then a story's scenarios can prove it's done" },
    );
    const ci = CI_FILES.find((f) => existsSync(join(root, f)));
    add(ci ? { name: "CI", status: "ok", found: ci } : { name: "CI", status: "warn", found: "validate and scenarios don't run on pull or merge requests", next: "Run nikos ci setup, so every pull or merge request runs the checks" });
    add(
      v.errors.length
        ? { name: "story map", status: "fail", found: `${v.errors.length} ${v.errors.length === 1 ? "problem" : "problems"} in maps/`, next: "Run nikos validate and fix what it lists" }
        : { name: "story map", status: v.warnings.length ? "warn" : "ok", found: `${count(v.stories, "story", "stories")} in ${count(maps, "map")}${v.warnings.length ? `, ${count(v.warnings.length, "warning")}` : ""}`, ...(v.warnings.length ? { next: "Run nikos validate to see the warnings" } : {}) },
    );
  } else if (!planOnly) {
    add({ name: "story map", status: "fail", found: "no maps/ folder", next: "Set up nikOS here (nikos init), or map what the repo already does" });
    return checks;
  }

  const settings = resolveSettings(root);
  const policy = settings["approval.policy"];
  // A group keeps its approval policy in its plan, so its lock check replaces the approvals check.
  if (planOnly || (maps && planLevel(root) === "group")) add(lockCheck(settings));
  else {
    const owners = codeowners(root);
    const protectedApprovals = owners && /\/approvals\//.test(readFileSync(owners, "utf8"));
    if (policy.value === "off") add({ name: "approvals", status: "ok", found: `off (${policy.from})` });
    else if (protectedApprovals) add({ name: "approvals", status: "ok", found: `${policy.value} (${policy.from}); maps/<key>/approvals/ needs a CODEOWNERS review` });
    else
      add({
        name: "approvals",
        status: policy.value === "required-for-release" ? "warn" : "ok",
        found: `${policy.value} (${policy.from}); anyone can add an approval`,
        ...(policy.value === "required-for-release" ? { next: "Protect maps/<key>/approvals/ with a CODEOWNERS rule and branch protection, so an approval needs the right reviewer" } : {}),
      });
  }

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
  const stale = staleCliWarning();
  if (stale) add({ name: "nikos command", status: "warn", found: stale.split(", so")[0], next: "Update it with npm install -g nikos@latest, or run npx -y nikos@latest" });

  if (planOnly) {
    let below: ReturnType<typeof downstreamEntries> = [];
    try {
      below = downstreamEntries(root);
    } catch (err) {
      add({ name: "plans below", status: "fail", found: (err as Error).message, next: "Fix planning/downstream.yaml" });
    }
    if (below.length) {
      const withRepo = below.filter((b) => b.entry).length;
      add({
        name: "plans below",
        status: "ok",
        found: `${count(below.length, "plan")} in planning/downstream.yaml${withRepo < below.length ? `, ${below.length - withRepo} with no repo yet` : ""}`,
        next: "See how they're doing with nikos planning rollout",
      });
    }
  }
  return checks;
}

/**
 * Whether a runner config runs the folder of stories: intent/features, or a maps/ folder for a group.
 * Comments don't count, so the template's header can't make a stale path look right. A config with no
 * paths of its own runs its defaults, so it passes.
 */
const runsFolder = (root: string, file: string, folder: string) => {
  const live = read(join(root, file))
    .split("\n")
    .filter((l) => !/^\s*(#|;|\/\/)/.test(l))
    .join("\n");
  return !/\bpaths\b/.test(live) || live.includes(folder);
};

/** A company or department plan: its plan, key results and bets, and its decisions. No story map is expected. */
function planChecks(root: string, add: (c: Check) => void) {
  let found: ReturnType<typeof planningIssues>;
  try {
    found = planningIssues(root);
  } catch (err) {
    // A plan that doesn't parse fails its own check; the story map and the runner still print.
    add({ name: "plan", status: "fail", found: `planning/ doesn't read: ${(err as Error).message.split("\n")[0]}`, next: "Run nikos planning validate and fix what it lists" });
    return;
  }
  // A group repo with maps/ is a group, not a plan-only repo: its story maps are the next check.
  const grouped = mapDirs(root).length > 0;
  const planShape = grouped ? "group" : "plan-only repo";
  const planTail = grouped ? "story maps in maps/" : "no story map needed";
  const issues = found.filter((i) => !i.warning);
  add(
    issues.length
      ? { name: "plan", status: "fail", found: `${count(issues.length, "problem")} in planning/`, next: "Run nikos planning validate and fix what it lists" }
      : {
          name: "plan",
          status: found.length ? "warn" : "ok",
          found: `${planShape}: ${count(krIds(root).length, "key result")}, ${count(betIds(root).length, "bet")}; ${planTail}${found.length ? `, ${count(found.length, "warning")}` : ""}`,
          ...(found.length ? { next: "Run nikos planning validate to see the warnings" } : {}),
        },
  );
  const n = decisionEntries(root).length;
  add(
    n
      ? { name: "decisions", status: "ok", found: `${count(n, "decision")} in ${rel(root, decisionsPath(root))}` }
      : { name: "decisions", status: "ok", found: store().exists(decisionsPath(root)) ? "none recorded yet" : `no ${rel(root, decisionsPath(root))} yet`, next: 'Record one when you make it, for example: nikos decide "Use cards only at launch" --why "Most buyers pay by card"' },
  );
}

/**
 * The approval settings a plan hands down. A policy the levels below can change is only advice;
 * one that's locked while the routes aren't still lets a team pick its own route.
 */
function lockCheck(settings: ReturnType<typeof resolveSettings>): Check {
  const policy = settings["approval.policy"];
  const routes = settings["approval.routes"];
  const found = `${policy.value} (${policy.from})`;
  if (policy.value === "off") return { name: "approvals", status: "ok", found };
  if (!policy.lockedBy)
    return {
      name: "approvals",
      status: "ok",
      found: `${found}, not locked: the plans below can change it`,
      ...(policy.value === "required-for-release" ? { next: "To hold every level below to it, add locked: [approval.policy, approval.routes] to nikos.settings.yaml" } : {}),
    };
  if (!routes.lockedBy) return { name: "approvals", status: "warn", found: `${found}, locked; approval.routes isn't, so a team below can choose its own routes`, next: "Add approval.routes to locked: in nikos.settings.yaml" };
  return { name: "approvals", status: "ok", found: `${found}, locked with its routes (${(routes.value as string[]).join(", ")})` };
}

export function runDoctor(args: string[]): number {
  const i = args.indexOf("--dir");
  const root = i >= 0 ? args[i + 1] : process.cwd();
  try {
    const checks = doctor(root, { offline: args.includes("--offline") });
    const mark = { ok: "✓", warn: "!", fail: "✗" };
    console.log(`Checking ${resolve(root)}\n`);
    for (const c of checks) console.log(`${mark[c.status]} ${c.name}: ${c.found}${c.next ? `\n    → ${c.next}` : ""}`);
    const fails = checks.filter((c) => c.status === "fail").length;
    const warns = checks.filter((c) => c.status === "warn").length;
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    console.log(
      `\n${fails ? `${plural(fails, "problem", "problems")} to fix (✗)` : "Nothing is broken."}${warns ? ` ${plural(warns, "thing", "things")} worth a look (!).` : fails ? "" : " Everything looks good."}${fails || warns ? " Each one says what to do next (→)." : ""}`,
    );
    return fails ? 1 : 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
