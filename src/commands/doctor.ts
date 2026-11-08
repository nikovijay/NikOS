// `nikos doctor`: is this repo set up the way nikOS works best? Each check says what it found
// and, when something's missing, the next thing to do, in words an agent can act on.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { count, decisionsPath, findIntentDir, isPlanOnly } from "../lib/project.js";
import { resolveSettings } from "../lib/settings.js";
import { store } from "../lib/store.js";
import { perStory } from "../lib/state-files.js";
import { detectStack } from "../verify/detect.js";
import { checkStale, readLock, upstreamEntries } from "../planning/upstream.js";
import { betIds, krIds } from "../planning/model.js";
import { planningIssues } from "../planning/levels.js";
import { downstreamEntries } from "../planning/rollout.js";
import { decisionEntries } from "./decisions.js";
import { staleCliWarning } from "../lib/cli-version.js";
import { validate, validateGroup } from "./validate.js";
import { mapDirs } from "../lib/maps.js";
import { isTeamRepo, openTeam, storyMapClash, TEAM_FILE, type TeamFile } from "../lib/team.js";
import { read } from "../lib/project.js";
import { storyFiles } from "../lib/state-files.js";
import { groupStatus } from "../team/sync.js";
import { groupMaps, readTeamIndex, short } from "../team/status.js";
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
    teamChecks(root, add, opts);
    return checks;
  }
  const intent = findIntentDir(root);
  const planOnly = isPlanOnly(root);
  const maps = mapDirs(root).length;
  if (planOnly) planChecks(root, add);
  else if (maps) {
    planChecks(root, add);
    teamStatusChecks(root, add);
    const v = validateGroup(root);
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
    add(
      v.errors.length
        ? { name: "story map", status: "fail", found: `${v.errors.length} ${v.errors.length === 1 ? "problem" : "problems"} in intent/`, next: "Run nikos validate and fix what it lists" }
        : { name: "story map", status: v.warnings.length ? "warn" : "ok", found: `${count(v.stories, "story", "stories")} in ${count(v.releases, "release")}${v.warnings.length ? `, ${count(v.warnings.length, "warning")}` : ""}`, ...(v.warnings.length ? { next: "Run nikos validate to see the warnings" } : {}) },
    );

    const runner = RUNNER_FILES.find((f) => existsSync(join(root, f)));
    add(
      runner
        ? { name: "scenario runner", status: "ok", found: runner }
        : { name: "scenario runner", status: "fail", found: detectStack(root) ? "no Cucumber runner yet" : "no runner, and the stack isn't clear", next: "Set one up with nikos verify setup, so stories can be proved done" },
    );

    const ci = CI_FILES.find((f) => existsSync(join(root, f)));
    add(ci ? { name: "CI", status: "ok", found: ci } : { name: "CI", status: "warn", found: "scenarios don't run on pull or merge requests", next: "Add the pipeline with nikos ci setup" });
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
 * A group with assignments: each assigned team's status fetch. A team never fetched, or whose last
 * fetch failed, is a warning; a group with no assignments gets no lines here.
 */
function teamStatusChecks(root: string, add: (c: Check) => void) {
  let teams = new Map<string, string>();
  try {
    for (const m of groupMaps(root)) for (const a of m.list) if (a.repo !== ".") teams.set(a.repo, a.team);
  } catch {
    return; // validate reports an assignments file that doesn't read
  }
  if (!teams.size) return;
  const index = readTeamIndex(root);
  for (const [repo, team] of teams) {
    const c = index.teams[repo];
    if (!c?.commit && !c?.attempted) add({ name: `team ${team}`, status: "warn", found: `${team} has never been fetched`, next: "Run nikos map status" });
    else if (!c.ok) add({ name: `team ${team}`, status: "warn", found: `${team}'s last fetch failed: ${c.error ?? "unknown error"}`, next: "Check the team's repo is reachable, then run nikos map status" });
    else add({ name: `team ${team}`, status: "ok", found: `team status last fetched ${c.fetched} at ${short(c.commit)}` });
  }
}

/**
 * A team repo: its team file, each group it takes work from (synced, moved on, or not yet), the
 * runner's glob for the assigned copies, the ignore rule, and a CODEOWNERS suggestion for the lead.
 */
function teamChecks(root: string, add: (c: Check) => void, opts: { offline?: boolean }) {
  let team: TeamFile | undefined;
  try {
    team = openTeam(root);
  } catch (err) {
    add({ name: "team", status: "fail", found: (err as Error).message.replace(`${TEAM_FILE}: `, ""), next: `Fix ${TEAM_FILE}` });
  }
  const clash = storyMapClash(root);
  if (clash) add({ name: "team", status: "fail", found: clash, next: "keep one: a team repo takes its stories from a group repo" });
  if (team && !clash) add({ name: "team", status: "ok", found: `"${team.name}", ${count(team.members.length, "member")}, ${count(team.groups.length, "group")}` });
  if (team) {
    if (!team.groups.length) add({ name: "groups", status: "warn", found: "takes work from no group yet", next: "Join one with nikos team join <group repo>" });
    for (const g of team.groups) {
      const st = groupStatus(root, g, { remote: !opts.offline });
      if (!st.synced) {
        add({ name: `group ${g.repo}`, status: "warn", found: "not synced yet", next: "Run nikos sync" });
        continue;
      }
      if (st.moved) add({ name: `group ${g.repo}`, status: "warn", found: `moved on since ${st.entry!.commit.slice(0, 7)} (synced ${st.entry!.synced})`, next: "Run nikos sync" });
      else add({ name: `group ${g.repo}`, status: "ok", found: `synced ${st.entry!.commit.slice(0, 7)} on ${st.entry!.synced}` });
    }
  }

  const runner = RUNNER_FILES.find((f) => existsSync(join(root, f)));
  if (!runner) add({ name: "scenario runner", status: "warn", found: "no runner config yet", next: "Set one up with nikos verify setup" });
  else if (runner !== "behave.ini" && !read(join(root, runner)).includes(".nikos/assigned")) {
    // behave takes its folders from nikos verify, which passes .nikos/assigned when it's there.
    add({ name: "scenario runner", status: "warn", found: `${runner} doesn't run the assigned stories`, next: `Add ".nikos/assigned/**/features/**/*.feature" to paths in ${runner}` });
  } else add({ name: "scenario runner", status: "ok", found: runner });

  const ignore = existsSync(join(root, ".gitignore")) && /^\/?\.nikos\/?$/m.test(read(join(root, ".gitignore")));
  add(ignore ? { name: "copies", status: "ok", found: ".nikos/ is gitignored" } : { name: "copies", status: "warn", found: ".nikos/ isn't gitignored", next: "Run nikos sync to add it" });

  const approvals = storyFiles(join(root, "approvals")).length;
  const lead = (team?.members ?? []).find((m) => /lead/i.test(m.role ?? "") && m.handle);
  const owners = codeowners(root);
  const guarded = !!owners && /approvals(\/|\.yaml|$)/m.test(read(owners));
  add({ name: "approvals", status: "ok", found: `${count(approvals, "delivery approval")} in approvals/`, ...(lead && !guarded ? { next: `Suggest: add "/approvals/ @${lead.handle}" to CODEOWNERS, so a delivery approval needs the lead's review` } : {}) });

  // Locks from the group and company copies that the team's settings take (see lib/settings.ts).
  for (const problem of resolveSettingsDetailed(root).problems) add({ name: "settings", status: "warn", found: problem, next: "Run nikos sync, or fix the group's nikos.settings.yaml" });

  const stale = staleCliWarning();
  if (stale) add({ name: "nikos command", status: "warn", found: stale.split(", so")[0], next: "Update it with npm install -g nikos@latest, or run npx -y nikos@latest" });
}

/** A company or department plan: its plan, key results and bets, and its decisions. No story map is expected. */
function planChecks(root: string, add: (c: Check) => void) {
  const found = planningIssues(root);
  const issues = found.filter((i) => !i.warning);
  add(
    issues.length
      ? { name: "plan", status: "fail", found: `${count(issues.length, "problem")} in planning/`, next: "Run nikos planning validate and fix what it lists" }
      : {
          name: "plan",
          status: found.length ? "warn" : "ok",
          found: `plan-only repo: ${count(krIds(root).length, "key result")}, ${count(betIds(root).length, "bet")}; no story map needed${found.length ? `, ${count(found.length, "warning")}` : ""}`,
          ...(found.length ? { next: "Run nikos planning validate to see the warnings" } : {}),
        },
  );
  const n = decisionEntries(root).length;
  add(
    n
      ? { name: "decisions", status: "ok", found: `${count(n, "decision")} in planning/decisions.md` }
      : { name: "decisions", status: "ok", found: store().exists(decisionsPath(root)) ? "none recorded yet" : "no planning/decisions.md yet", next: 'Record one with nikos decide "<title>" --why "<why>"' },
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
    for (const c of checks) console.log(`${mark[c.status]} ${c.name}: ${c.found}${c.next ? `\n    → ${c.next}` : ""}`);
    return checks.some((c) => c.status === "fail") ? 1 : 0;
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 1;
  }
}
