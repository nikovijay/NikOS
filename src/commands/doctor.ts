// `nikos doctor`: is this repo set up the way nikOS works best? Each check says what it found
// and, when something's missing, the next thing to do, in words an agent can act on.
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { count, decisionsPath, rel } from "../lib/project.js";
import { resolveSettings, resolveSettingsDetailed } from "../lib/settings.js";
import { store } from "../lib/store.js";
import { detectStack } from "../verify/detect.js";
import { betIds, isPlanRepo, krIds } from "../planning/model.js";
import { listAreas, oldLayoutProblem } from "../plan/repo.js";
import { planIssues } from "../plan/cli.js";
import { planDeliveries } from "../plan/delivery.js";
import { loadRepos, type RepoEntry } from "../plan/repos.js";
import { hostOfEntry } from "../plan/refresh.js";
import { decisionEntries } from "./decisions.js";
import { staleCliWarning } from "../lib/cli-version.js";
import { validateGroup } from "./validate.js";
import { mapDirs, mapOwnerOf } from "../lib/maps.js";
import { LINK_FILE, planHead, readLink, SNAPSHOT_STALE_DAYS, linkProblem, type PlanLink } from "../plan/settings-link.js";

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
  // A planning repo is checked as a plan: its areas, the code repos it lists, and its decisions.
  if (isPlanRepo(root)) {
    planRepoChecks(root, add);
    return checks;
  }
  const old = oldLayoutProblem(root);
  if (old) {
    add({ name: "plan", status: "fail", found: old, next: "Make the company's planning repo in a new folder with nikos plan init, then move the story map by hand" });
    return checks;
  }
  const maps = mapDirs(root).length;
  const oldLayout = store().isDir(join(root, "intent"));
  if (oldLayout) {
    // A repo that still keeps its story map in intent/ can't be checked until it moves.
    add({ name: "story map", status: "fail", found: "this repo keeps its story map in intent/, the old layout", next: "Move intent/ to maps/<key>/ by hand, as the release notes describe, then commit the result" });
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
  } else {
    add({ name: "story map", status: "fail", found: "no maps/ folder", next: "Set up nikOS here (nikos init), or map what the repo already does" });
    return checks;
  }

  const settings = resolveSettings(root);
  const policy = settings["approval.policy"];
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

  const tracker = settings["tracker.system"];
  if (tracker.value !== "none") {
    const mapped = Object.keys(settings["tracker.statuses"].value as object).length;
    add(
      mapped
        ? { name: "tracker", status: "ok", found: `${tracker.value} (${tracker.from}), ${mapped} statuses mapped` }
        : { name: "tracker", status: "warn", found: `${tracker.value}, but no statuses mapped`, next: "Connect the tracker: map its statuses to nikOS's" },
    );
  }

  const link = readLink(root);
  if (link) planLinkChecks(root, link, add, opts);

  const stale = staleCliWarning();
  if (stale) add({ name: "nikos command", status: "warn", found: stale.split(", so")[0], next: "Update it with npm install -g nikos@latest, or run npx -y nikos@latest" });

  return checks;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A code repo linked to a plan (nikos.plan.yaml): the snapshot matches its hash and is fresh, the plan
 * hasn't moved on (a network check, skipped with --offline), each map's owner has a team in the snapshot,
 * and no value of this repo's own file is ignored because a level above locks it.
 */
function planLinkChecks(root: string, link: PlanLink, add: (c: Check) => void, opts: { offline?: boolean }) {
  const plan = link.plan.repo;
  const edited = linkProblem(root);
  if (edited) {
    add({ name: "plan settings", status: "fail", found: `${LINK_FILE}'s settings were edited by hand`, next: "Run nikos settings pull to refresh them from the plan, then commit it" });
  } else {
    const days = Math.max(0, Math.floor((Date.now() - Date.parse(link.read.at)) / DAY_MS));
    const found = `from ${plan} at ${link.read.commit.slice(0, 7)}, read ${days === 0 ? "today" : `${count(days, "day")} ago`}`;
    add(days > SNAPSHOT_STALE_DAYS ? { name: "plan settings", status: "warn", found, next: "Run nikos settings pull to refresh them from the plan" } : { name: "plan settings", status: "ok", found });
  }

  if (!opts.offline) {
    const head = planHead(link);
    if ("error" in head) add({ name: "plan current", status: "warn", found: `couldn't reach ${plan} to check it: ${head.error}`, next: "Check that you can read the plan, or run nikos doctor --offline to skip this check" });
    else if (head.commit !== link.read.commit) add({ name: "plan current", status: "warn", found: `${plan} has moved on since the snapshot (${link.read.commit.slice(0, 7)} → ${head.commit.slice(0, 7)})`, next: "Run nikos settings pull to refresh them from the plan" });
    else add({ name: "plan current", status: "ok", found: `${plan} hasn't moved on since the snapshot` });
  }

  const gaps = mapDirs(root).flatMap((dir) => {
    const id = basename(dir);
    const owner = mapOwnerOf(dir);
    if (!owner) return [`maps/${id} has no owner`];
    return link.owners[owner] ? [] : [`${owner} (maps/${id}) has no team in ${plan}`];
  });
  add(
    gaps.length
      ? { name: "map owners", status: "warn", found: `${gaps.join("; ")}, so those maps take the company's settings only`, next: "Set each map's owner in storymap.yaml to a team in the plan, or add the team to the plan, then run nikos settings pull" }
      : { name: "map owners", status: "ok", found: "every map's owner has a team in the plan" },
  );

  // A value here that a level above locks does nothing, so it's reported where it can be fixed.
  const ignored = resolveSettingsDetailed(root).problems.filter((p) => p.includes(" from this repo is ignored: "));
  add(
    ignored.length
      ? { name: "own settings", status: "warn", found: ignored.join("; "), next: "Remove those keys from nikos.settings.yaml: the plan locks them" }
      : { name: "own settings", status: "ok", found: "none ignored" },
  );
}

/**
 * Whether a runner config runs the folder of stories: a maps/ folder (one or more maps).
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
 * A planning repo: the plan (its areas, key results and bets, and any problems), the code repos it lists
 * and whether each has been read, and the company's decisions.
 */
function planRepoChecks(root: string, add: (c: Check) => void) {
  const areas = listAreas(root);
  const issues = planIssues(root);
  const errors = issues.filter((i) => !i.warning).length;
  const warnings = issues.length - errors;
  const krs = areas.reduce((n, a) => n + krIds(a.dir).length, 0);
  const bets = areas.reduce((n, a) => n + betIds(a.dir).length, 0);
  add(
    errors
      ? { name: "plan", status: "fail", found: `${count(errors, "problem")} in planning/`, next: "Run nikos plan validate and fix what it lists" }
      : {
          name: "plan",
          status: warnings ? "warn" : "ok",
          found: `${count(areas.length, "area", "areas")}, ${count(krs, "key result")}, ${count(bets, "bet")}${warnings ? `, ${count(warnings, "warning")}` : ""}`,
          ...(warnings ? { next: "Run nikos plan validate to see the warnings" } : {}),
        },
  );
  let listed: RepoEntry[] = [];
  try {
    listed = loadRepos(root).repos;
  } catch {
    // planning/repos.yaml that doesn't load is a problem plan validate reports.
  }
  const deliveries = planDeliveries(root);
  const readCount = listed.filter((e) => deliveries.repos.some((r) => r.repo === e.repo && r.host === hostOfEntry(e))).length;
  add(
    !listed.length
      ? { name: "code repos", status: "ok", found: "none listed yet in planning/repos.yaml" }
      : {
          name: "code repos",
          status: readCount === listed.length ? "ok" : "warn",
          found: `${count(listed.length, "code repo", "code repos")} listed: ${readCount} read, ${listed.length - readCount} never read`,
          ...(readCount < listed.length ? { next: "Run nikos plan refresh to read them" } : {}),
        },
  );
  const n = decisionEntries(root).length;
  add(
    n
      ? { name: "decisions", status: "ok", found: `${count(n, "decision")} in ${rel(root, decisionsPath(root))}` }
      : { name: "decisions", status: "ok", found: store().exists(decisionsPath(root)) ? "none recorded yet" : `no ${rel(root, decisionsPath(root))} yet`, next: 'Record one when you make it, for example: nikos decide "Use cards only at launch" --why "Most buyers pay by card"' },
  );
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
