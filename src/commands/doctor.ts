// `nikos doctor`: is this repo set up the way nikOS works best? Each check says what it found
// and, when something's missing, the next thing to do, in words an agent can act on.
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parse } from "yaml";
import { keyFor } from "./init.js";
import { count, decisionsPath, findIntentDir, isPlanOnly } from "../lib/project.js";
import { resolveSettings } from "../lib/settings.js";
import { store } from "../lib/store.js";
import { perStory } from "../lib/state-files.js";
import { detectStack } from "../verify/detect.js";
import { checkStale, readLock, upstreamEntries } from "../planning/upstream.js";
import { betIds, krIds } from "../planning/model.js";
import { planningIssues } from "../planning/levels.js";
import { loadPlan } from "../planning/model.js";
import { downstreamEntries } from "../planning/rollout.js";
import { decisionEntries } from "./decisions.js";
import { staleCliWarning } from "../lib/cli-version.js";
import { validate, validateGroup, validateTeam } from "./validate.js";
import { mapDirs, ownMapsOf } from "../lib/maps.js";
import { isTeamRepo, openTeam, storyMapClash, TEAM_FILE, teamOptedIn, type TeamFile } from "../lib/team.js";

/** What a team plan's check says, in every repo it shows up in. */
const TEAM_PLAN_FOUND = "team plan in planning/plan.yaml";
const TEAM_PLAN_NEXT = "Team plans are going away. Move each key result to the department's plan, or rewrite it as a bet aimed at a department key result (krs: <department repo>#<kr-id>). Nothing is deleted.";
/** The migrate hint, with this repo's own ids: the map's key, and the group key migrate suggests (from the folder name). */
const migrateNext = (root: string, intent: string) => {
  let key = "HT";
  try {
    const k = parse(read(join(intent, "storymap.yaml")))?.key;
    if (typeof k === "string" && k) key = k;
  } catch {
    // validate reports a storymap that doesn't parse; the hint keeps its example ids.
  }
  return `nikos migrate maps moves it under a group plan. Story ids without the group key stop it unless you pass --rename-ids (${key}-1 becomes ${keyFor(basename(resolve(root)))}-${key}-1). Nothing moves until you confirm.`;
};
/** The plan's level, or undefined when planning/plan.yaml doesn't parse: the file's own checks say so, and the rest of doctor still runs. */
// The level in planning/plan.yaml only: a team repo with no plan.yaml has no plan level (levelOf says team for it).
const planLevel = (root: string) => {
  try {
    return loadPlan(root)?.level;
  } catch {
    return undefined;
  }
};
import { read } from "../lib/project.js";
import { storyFiles } from "../lib/state-files.js";
import { resolveSettingsDetailed } from "../lib/settings.js";

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
  if (isTeamRepo(root)) {
    teamChecks(root, add);
    return checks;
  }
  const intent = findIntentDir(root);
  const planOnly = isPlanOnly(root);
  const maps = mapDirs(root).length;
  if (planOnly) planChecks(root, add);
  else if (maps) {
    planChecks(root, add);
    const v = validateGroup(root);
    const runner = RUNNER_FILES.find((f) => existsSync(join(root, f)));
    if (runner && !runsFolder(root, runner, "maps/")) add({ name: "scenario runner", status: "warn", found: `${runner} doesn't list the story's features folder`, next: "Your runner config does not list the story's features folder. Add it, or run nikos verify setup on a fresh config." });
    // A group that is its own team (or just runs validate in CI) keeps the runner and CI lines it had as an intent/ repo.
    if (runner && runsFolder(root, runner, "maps/")) add({ name: "scenario runner", status: "ok", found: runner });
    const ci = CI_FILES.find((f) => existsSync(join(root, f)));
    add(ci ? { name: "CI", status: "ok", found: ci } : { name: "CI", status: "warn", found: "validate and scenarios don't run on pull or merge requests", next: "Run nikos ci setup, so every pull or merge request runs the checks" });
    add(
      v.errors.length
        ? { name: "story map", status: "fail", found: `${v.errors.length} ${v.errors.length === 1 ? "problem" : "problems"} in maps/`, next: "Run nikos validate and fix what it lists" }
        : { name: "story map", status: v.warnings.length ? "warn" : "ok", found: `${count(v.stories, "story", "stories")} in ${count(maps, "map")}${v.warnings.length ? `, ${count(v.warnings.length, "warning")}` : ""}`, ...(v.warnings.length ? { next: "Run nikos validate to see the warnings" } : {}) },
    );
  } else if (!store().exists(join(intent, "storymap.yaml"))) {
    add({ name: "story map", status: "fail", found: "no intent/ folder", next: "Set up nikOS here (nikos init), or map what the repo already does. For a company or department plan, nikos company init" });
    return checks;
  } else {
    const v = validate(root);
    const teamPlan = planLevel(root) === "team";
    // A 0.2.x repo is fine as it is: the migration is a hint on its story map, never a failure.
    // The hints go on the warn case too, so a repo with a warning still hears about the move.
    const hints = [teamPlan ? TEAM_PLAN_NEXT : "", migrateNext(root, intent)].filter(Boolean).join(" ");
    add(
      v.errors.length
        ? { name: "story map", status: "fail", found: `${v.errors.length} ${v.errors.length === 1 ? "problem" : "problems"} in intent/`, next: "Run nikos validate and fix what it lists" }
        : { name: "story map", status: v.warnings.length ? "warn" : "ok", found: `${count(v.stories, "story", "stories")} in ${count(v.releases, "release")}${v.warnings.length ? `, ${count(v.warnings.length, "warning")}` : ""}`, next: [v.warnings.length ? "Run nikos validate to see the warnings" : "", hints].filter(Boolean).join(" ") },
    );
    // A team plan here is a hint on the story map, so the checks an intent/ repo already has keep their names.
    const runner = RUNNER_FILES.find((f) => existsSync(join(root, f)));
    add(
      runner
        ? runsFolder(root, runner, "intent/features")
          ? { name: "scenario runner", status: "ok", found: runner }
          : { name: "scenario runner", status: "warn", found: `${runner} doesn't list the story's features folder`, next: "Your runner config does not list the story's features folder. Add it, or run nikos verify setup on a fresh config." }
        : { name: "scenario runner", status: "fail", found: detectStack(root) ? "no Cucumber runner yet (it runs each story's scenarios)" : "no Cucumber runner yet, and nikOS can't tell which language this project uses", next: "Run nikos verify setup. Then a story's scenarios can prove it's done" },
    );

    const ci = CI_FILES.find((f) => existsSync(join(root, f)));
    add(ci ? { name: "CI", status: "ok", found: ci } : { name: "CI", status: "warn", found: "scenarios don't run on pull or merge requests", next: "Run nikos ci setup, so every pull or merge request runs the checks" });
  }

  const settings = resolveSettings(root);
  const policy = settings["approval.policy"];
  if (planOnly || maps) add(lockCheck(settings));
  else {
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

/**
 * A team repo: its team file, its own maps, the scenario runner, and its delivery approvals.
 */
function teamChecks(root: string, add: (c: Check) => void) {
  let team: TeamFile | undefined;
  try {
    team = openTeam(root);
  } catch (err) {
    add({ name: "team", status: "fail", found: (err as Error).message.replace(`${TEAM_FILE}: `, ""), next: `Fix ${TEAM_FILE}` });
  }
  const clash = storyMapClash(root);
  if (clash) add({ name: "team", status: "fail", found: clash, next: "Move intent/ into this team's maps/<key>/ with nikos migrate maps --team-key <KEY> --home <repo>." });
  if (planLevel(root) === "team") add({ name: "plan", status: "warn", found: TEAM_PLAN_FOUND, next: TEAM_PLAN_NEXT });
  if (team && !clash) add({ name: "team", status: "ok", found: `"${team.name}", ${count(team.members.length, "member")}, ${count(team.groups.length, "group")}` });
  // The team's own maps (maps/<key>/) are checked as one: their stories, bets, key, folder and state.
  const own = ownMapsOf(root);
  if (own.length && !clash) {
    const v = validateTeam(root);
    const mine = v.errors.filter((e) => e.file.startsWith("maps/"));
    add({ name: "maps", status: mine.length ? "fail" : "ok", found: `${count(own.length, "own map")}${mine.length ? `, ${mine.length} problem${mine.length === 1 ? "" : "s"}` : ""}`, next: mine.length ? "Fix the problems nikos validate lists" : undefined });
  }
  // A team that joins a plan needs a key and exactly one home among the plans it joined (amendment, rule 1).
  // The home checks are for a team that has opted in: a 0.3.0 team with a joined plan and no home reads as it did.
  if (team && teamOptedIn(root)) {
    const joined = (() => {
      try {
        return upstreamEntries(root).map((u) => u.repo);
      } catch {
        return [];
      }
    })();
    if (joined.length && !team.home) add({ name: "home", status: "warn", found: "joins a plan but has no home", next: "Make one of the plans it joined its home: nikos join <plan> --home" });
    if (team.home && !team.key) add({ name: "key", status: "warn", found: "has a home but no key", next: `Add key: <KEY> to ${TEAM_FILE}` });
    if (team.home && !joined.includes(team.home) && !team.groups.some((g) => g.repo === team.home)) add({ name: "home", status: "warn", found: `${team.home} is not a plan the team joined`, next: `Join it with nikos join ${team.home} --home` });
  }
  const runner = RUNNER_FILES.find((f) => existsSync(join(root, f)));
  if (!runner) add({ name: "scenario runner", status: "warn", found: "no runner config yet", next: "Set one up with nikos verify setup" });
  else {
    // A team keeps its own step definitions: python's in steps/, cucumber's in test/steps (the template's import).
    const steps = runner === "behave.ini" ? "steps" : "test/steps";
    add(
      existsSync(join(root, steps))
        ? { name: "scenario runner", status: "ok", found: runner }
        : { name: "scenario runner", status: "warn", found: `${runner} has no ${steps}/ folder of step definitions`, next: `Add the step definitions in ${steps}/: a team keeps its own, and the runner reads them there` },
    );
  }

  const approvals = storyFiles(join(root, "approvals")).length;
  const lead = (team?.members ?? []).find((m) => /lead/i.test(m.role ?? "") && m.handle);
  const owners = codeowners(root);
  const guarded = !!owners && /approvals(\/|\.yaml|$)/m.test(read(owners));
  add({ name: "approvals", status: "ok", found: `${count(approvals, "delivery approval")} in approvals/`, ...(lead && !guarded ? { next: `Suggest: add "/approvals/ @${lead.handle}" to CODEOWNERS, so a delivery approval needs the lead's review` } : {}) });

  // Locks from the group and company copies that the team's settings take (see lib/settings.ts).
  for (const problem of resolveSettingsDetailed(root).problems) add({ name: "settings", status: "warn", found: problem, next: "Run nikos planning sync, or fix the plan's nikos.settings.yaml" });

  const stale = staleCliWarning();
  if (stale) add({ name: "nikos command", status: "warn", found: stale.split(", so")[0], next: "Update it with npm install -g nikos@latest, or run npx -y nikos@latest" });
}

/** A company or department plan: its plan, key results and bets, and its decisions. No story map is expected. */
function planChecks(root: string, add: (c: Check) => void) {
  const found = planningIssues(root);
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
      ? { name: "decisions", status: "ok", found: `${count(n, "decision")} in planning/decisions.md` }
      : { name: "decisions", status: "ok", found: store().exists(decisionsPath(root)) ? "none recorded yet" : "no planning/decisions.md yet", next: 'Record one when you make it, for example: nikos decide "Use cards only at launch" --why "Most buyers pay by card"' },
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
