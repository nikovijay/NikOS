// `nikos migrate maps`: a 0.2.x intent/ moves to maps/<key>/ of a group that is its own team. The
// fixture is a realistic 0.2.x repo: a story map with four stories, per-story state and an approval,
// features with tags, a plan, a decision, CODEOWNERS, .gitignore and a cucumber config.
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { MigrateError, migrateMaps, planMapsMigration, renderPlan, targetProblems, applyMapsPlan, unknownFlags } from "../src/commands/migrate-maps";
import { renameIds, retagFeature, renameDecisionHeadings, type IdTable } from "../src/lib/id-rename";
import { moveCodeowners } from "../src/lib/codeowners";
import { rewriteRunnerPaths } from "../src/lib/runner-paths";
import { specHash } from "../src/lib/project";
import { validate, validateGroup } from "../src/commands/validate";
import { planningIssues } from "../src/planning/levels";
import { git, groupRepo, write } from "./team-fixture";
import { setupVerify } from "../src/commands/verify";
import { teamInit, teamJoin } from "../src/commands/team";
import { doctor } from "../src/commands/doctor";

const STORYMAP = `format_version: 1
project: hello-todo
key: HT
activities:
  - id: tasks
    title: Manage tasks
    steps:
      - id: capture
        title: Capture a task
releases:
  - number: 1
    title: MVP
    bets: [checkout-speed]
    stories: [HT-1, HT-2, HT-12]
  - number: 2
    title: Next
    stories: [HT-3]
`;

const feature = (id: string, release: number, activity: string, title: string, depends?: string) =>
  `@${id} @release-${release} @must @activity-${activity}${depends ? ` @depends-${depends}` : ""}\nFeature: ${title}\n\n  As a person\n  I want ${title.toLowerCase()}\n  So that I keep my list\n\n  @AC1 @must\n  Scenario: AC1 — ${title}\n    Given an empty list\n    When I add "Buy milk"\n    Then I see "Buy milk"\n`;

const BET = (id: string, aligns?: string) =>
  `---\nid: ${id}\nowner: Product\nhypothesis: Faster checkout keeps people paying.\nkrs:\n  also: []\n${aligns ? `aligns_to: ${aligns}\n` : ""}review_on: 2027-01-15\nconfidence: medium\ndependencies: []\noutcome: open\nreviews: []\n---\n\n## Why we think so\nTesters said checkout is slow.\n`;

const TEAM_PLAN = "name: Hello Todo\nperiod: Q4 2026\nlevel: team\npillars: [Focus]\n";

interface Opts {
  storymap?: string;
  plan?: string | null;
  bets?: Record<string, string>;
  extra?: Record<string, string>;
  noGit?: boolean;
}

/** A 0.2.x repo, committed clean. */
function legacyRepo(o: Opts = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-mig-"));
  const add1 = feature("HT-1", 1, "tasks", "Add a task");
  const add2 = feature("HT-2", 1, "tasks", "Reorder tasks", "HT-1");
  const add3 = feature("HT-3", 2, "tasks", "See the top three");
  const add12 = feature("HT-12", 1, "tasks", "Keep a note");
  write(join(dir, "intent/storymap.yaml"), o.storymap ?? STORYMAP);
  write(join(dir, "intent/features/tasks/add-task.feature"), add1);
  write(join(dir, "intent/features/tasks/reorder-tasks.feature"), add2);
  write(join(dir, "intent/features/tasks/see-top-three.feature"), add3);
  write(join(dir, "intent/features/tasks/keep-note.feature"), add12);
  write(join(dir, "intent/state/HT-1.yaml"), "status: done\nplan_version: 1\nupdated: 2026-10-02\n");
  write(join(dir, "intent/state/HT-2.yaml"), "status: in_progress\nticket: PAY-123\nupdated: 2026-10-02\n");
  write(join(dir, "intent/state/HT-3.yaml"), "status: todo\n");
  write(join(dir, "intent/state/HT-12.yaml"), "status: todo\n");
  write(join(dir, "intent/state.yaml"), "format_version: 1\nstories: {}\n");
  write(join(dir, "intent/approvals/HT-1.yaml"), `by: Ada Lovelace\non: 2026-10-02\nspec_hash: ${specHash(add1)}\ndone_at: 2026-10-02\n`);
  write(join(dir, "intent/plans/HT-12.v1.md"), "# HT-12 plan\n\nKeep a note, as HT-12 asks.\n");
  write(join(dir, "intent/decisions.md"), "# Decisions\n\n## 2026-10-01 — chose a list (HT-12)\n**Category:** architecture\n**Supersedes:** none\n\nWhy HT-12.\n");
  write(join(dir, "intent/constitution.md"), readFileSync(join(__dirname, "../examples/hello-todo/intent/constitution.md"), "utf8"));
  if (o.plan !== null) write(join(dir, "planning/plan.yaml"), o.plan ?? TEAM_PLAN);
  for (const [id, text] of Object.entries(o.bets ?? { "checkout-speed": BET("checkout-speed") })) write(join(dir, `planning/bets/${id}.md`), text);
  write(join(dir, "CODEOWNERS"), "/intent/approvals/ @acme/pm\n/intent/features/ @acme/qa\n/src/ @acme/dev\n");
  write(join(dir, ".gitignore"), "node_modules/\nintent/tmp/\n");
  write(join(dir, "cucumber.mjs"), 'export default {\n  paths: ["intent/features/**/*.feature"],\n  import: ["test/steps/**/*.steps.mjs"],\n  format: ["progress"],\n};\n');
  for (const [path, text] of Object.entries(o.extra ?? {})) write(join(dir, path), text);
  if (!o.noGit) {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "fixture");
  }
  return dir;
}

/** Every file under a folder, with its text, for byte-identical checks. */
function treeOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walkDir = (d: string) => {
    for (const f of readdirSync(d)) {
      if (f === ".git") continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walkDir(p);
      else out[relative(dir, p)] = readFileSync(p, "utf8");
    }
  };
  walkDir(dir);
  return out;
}
const hashOf = (dir: string) => createHash("sha256").update(JSON.stringify(treeOf(dir))).digest("hex");

/** A refusal's code and message, from a migration that must fail. */
async function refusal(p: Promise<unknown>): Promise<MigrateError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(MigrateError);
    return err as MigrateError;
  }
  throw new Error("expected the migration to refuse");
}

const yes = { yes: true, renameIds: true, groupKey: "PAY", period: "Q4 2026", team: "hello-todo" };

describe("the id, feature, codeowners and runner rewrites", () => {
  const table: IdTable = new Map([["HT-12", "PAY-HT-12"]]);

  it("renames whole tokens only, and is idempotent", () => {
    expect(renameIds("HT-12 and @HT-12-x", table).text).toBe("PAY-HT-12 and @HT-12-x".replace("@HT-12-x", "@HT-12-x"));
    expect(renameIds("HT-120 untouched", table).text).toBe("HT-120 untouched");
    expect(renameIds("XHT-12 untouched", table).text).toBe("XHT-12 untouched");
    expect(renameIds("HT-12-x untouched", table).text).toBe("HT-12-x untouched");
    expect(renameIds("PAY-HT-12 stays", table).text).toBe("PAY-HT-12 stays");
    expect(renameIds("PAY-HT-12 stays", table).count).toBe(0);
  });

  it("retags only the tags above Feature:, keeps the body, and keeps the spec hash", () => {
    const text = feature("HT-2", 1, "tasks", "Reorder tasks", "HT-1").replace("I want reorder tasks", "I want HT-1 to stay put");
    const r = retagFeature(text, new Map([["HT-1", "PAY-HT-1"], ["HT-2", "PAY-HT-2"]]));
    expect(r.text.split("\n")[0]).toBe("@PAY-HT-2 @release-1 @must @activity-tasks @depends-PAY-HT-1");
    expect(r.text).toContain("I want HT-1 to stay put");
    expect(r.count).toBe(2);
    expect(specHash(r.text)).toBe(specHash(text));
  });

  it("renames decision headings and leaves the rest of a decision alone", () => {
    const r = renameDecisionHeadings("## 2026-10-01 — chose a list (HT-12)\nWhy HT-12.\n", new Map([["HT-12", "PAY-HT-12"]]));
    expect(r.text).toBe("## 2026-10-01 — chose a list (PAY-HT-12)\nWhy HT-12.\n");
  });

  it("moves CODEOWNERS rules under intent/ and keeps the others", () => {
    const r = moveCodeowners("/intent/approvals/ @acme/pm\nintent/features/ @acme/qa\n/src/ @acme/dev\n", "ht");
    expect(r.text).toBe("/maps/ht/approvals/ @acme/pm\nmaps/ht/features/ @acme/qa\n/src/ @acme/dev\n");
    expect(r.changed).toHaveLength(2);
  });

  it("rewrites the cucumber and behave paths it knows, and reports any other form", () => {
    const cuke = 'export default {\n  paths: ["intent/features/**/*.feature"],\n};\n';
    expect(rewriteRunnerPaths("cucumber.mjs", cuke, "ht").text).toBe('export default {\n  paths: ["maps/ht/features/**/*.feature"],\n};\n');
    const withMaps = 'export default {\n  paths: ["intent/features/**/*.feature", "maps/*/features/**/*.feature"],\n};\n';
    expect(rewriteRunnerPaths("cucumber.mjs", withMaps, "ht").text).toContain('paths: ["maps/*/features/**/*.feature"]');
    expect(rewriteRunnerPaths("behave.ini", "[behave]\npaths = intent/features\n", "ht").text).toBe("[behave]\npaths = maps/ht/features\n");
    expect(rewriteRunnerPaths("cucumber.mjs", 'export default { paths: ["x/**/*.feature"] };\n', "ht").text).toBeUndefined();
    const odd = rewriteRunnerPaths("cucumber.js", 'const paths = ["intent/features/**/*.feature"].concat(extra);\n', "ht");
    expect(odd.text).toBeUndefined();
    expect(odd.hint).toContain("Runner config cucumber.js lists paths the migration doesn't know");
  });
});

describe("refusals, with their exact messages", () => {
  it("says there is nothing to migrate without an intent/ story map", async () => {
    const dir = legacyRepo();
    const bare = mkdtempSync(join(tmpdir(), "nikos-none-"));
    const e = await refusal(migrateMaps(bare, { yes: true }));
    expect(e.code).toBe(1);
    expect(e.message).toBe("Nothing to migrate: there is no intent/storymap.yaml here.");
    expect(dir).toBeTruthy();
  });

  it("refuses a repo that already has maps/", async () => {
    const dir = legacyRepo({ extra: { "maps/x/.keep": "" } });
    expect((await refusal(migrateMaps(dir, yes))).message).toBe("This repo already has maps/. Migrate needs a repo with intent/ and no maps/.");
  });

  it("refuses a team repo, with the move-then-join steps", async () => {
    const dir = legacyRepo({ extra: { "nikos.team.yaml": "format_version: 1\nname: X\nrepo: a/b\ngroups: []\nmembers: []\n" } });
    expect((await refusal(migrateMaps(dir, yes))).message).toBe(
      "This is a team repo, and a team repo can't hold a story map. Move intent/ into a group repo with nikos migrate maps there, delete intent/ here, then nikos team join.",
    );
  });

  it("refuses a dirty tree and names the first paths", async () => {
    const dir = legacyRepo();
    write(join(dir, "scratch.txt"), "mine\n");
    expect((await refusal(migrateMaps(dir, yes))).message).toMatch(/^Uncommitted changes in: scratch\.txt\. Commit or stash them first/);
  });

  it("refuses when nikos/migrate-maps already exists", async () => {
    const dir = legacyRepo();
    git(dir, "branch", "nikos/migrate-maps");
    expect((await refusal(migrateMaps(dir, yes))).message).toBe("Branch nikos/migrate-maps already exists. Delete it, or pass --branch-name <name>.");
  });

  it("refuses an intent/ entry it doesn't move", async () => {
    const dir = legacyRepo({ extra: { "intent/notes.txt": "hi\n" } });
    expect((await refusal(migrateMaps(dir, yes))).message).toBe("intent/ has notes.txt, which migrate does not move. Move or remove it first.");
  });

  it("refuses when planning/decisions.md and intent/decisions.md both exist", async () => {
    const dir = legacyRepo({ extra: { "planning/decisions.md": "# Decisions\n" } });
    expect((await refusal(migrateMaps(dir, yes))).message).toBe("planning/decisions.md and intent/decisions.md both exist. Merge them by hand, then retry.");
  });

  it("refuses a story map that fails validate, and moves nothing", async () => {
    const dir = legacyRepo({ storymap: STORYMAP.replace("format_version: 1", "format_version: 2") });
    const e = await refusal(migrateMaps(dir, yes));
    expect(e.message).toMatch(/^Fix intent\/ first: nikos validate lists \d+ problems?\. Nothing has been moved\./);
    expect(existsSync(join(dir, "intent/storymap.yaml"))).toBe(true);
  });

  it("refuses a team plan with key results, and says what to do", async () => {
    const dir = legacyRepo({ extra: { "planning/krs/missed.yaml": "id: missed\n" } });
    expect((await refusal(migrateMaps(dir, yes))).message).toBe(
      "planning/plan.yaml is a team plan with 1 key result. A group plan has none. Move each to the department's plan, or rewrite it as a bet aimed at a department key result (krs: <department repo>#<kr-id>), then retry.",
    );
  });

  it("refuses a company or department plan: a repo holds one plan", async () => {
    const dir = legacyRepo({ plan: "name: Acme\nperiod: Q4 2026\nlevel: company\npillars: []\n" });
    expect((await refusal(migrateMaps(dir, yes))).message).toBe("planning/plan.yaml is a company plan. A repo holds one plan: put the group in its own repo.");
  });

  it("refuses ids without the group key, lists them, and says to rerun with --rename-ids", async () => {
    const dir = legacyRepo();
    const before = hashOf(dir);
    const e = await refusal(migrateMaps(dir, { yes: true, groupKey: "PAY", period: "Q4 2026" }));
    expect(e.message).toMatch(/^4 story ids don't carry the group key \(PAY\): HT-1, HT-2, HT-12, HT-3\.\nRerun with --rename-ids to rename them \(HT-n becomes PAY-HT-n\)/);
    expect(hashOf(dir)).toBe(before);
  });

  it("with several bets named and no --bet, a non-terminal run is a usage error that names --bet", async () => {
    const storymap = STORYMAP.replace("bets: [checkout-speed]", "bets: [checkout-speed, billing]");
    const dir = legacyRepo({ storymap, bets: { "checkout-speed": BET("checkout-speed"), billing: BET("billing") } });
    const e = await refusal(migrateMaps(dir, yes));
    expect(e.code).toBe(2);
    expect(e.message).toBe("Several bets are named (checkout-speed, billing): pass --bet <id> to choose the one this map specs.");
  });

  it("with no bet named and no --bet or --new-bet, a usage error names both", async () => {
    const dir = legacyRepo({ storymap: STORYMAP.replace("    bets: [checkout-speed]\n", "") });
    const e = await refusal(migrateMaps(dir, yes));
    expect(e.code).toBe(2);
    expect(e.message).toBe("No bet is named in the releases: pass --bet <id> for an existing bet, or --new-bet <id> to make a stub.");
  });

  it("a non-terminal run without --yes or --dry-run is a usage error, and writes nothing", async () => {
    const dir = legacyRepo();
    const before = hashOf(dir);
    const e = await refusal(migrateMaps(dir, { groupKey: "PAY", renameIds: true }));
    expect(e.code).toBe(2);
    expect(e.message).toMatch(/^Nothing written: this isn't a terminal, so pass --yes/);
    expect(hashOf(dir)).toBe(before);
  });
});

describe("the plan", () => {
  it("prints the moves, the creates, the ids and what to check by hand", async () => {
    const dir = legacyRepo({ storymap: `${STORYMAP}story_bets:\n  HT-1: [checkout-speed]\n` });
    const r = await migrateMaps(dir, { ...yes, dryRun: true });
    const text = r.lines.join("\n");
    expect(r.written).toBe(false);
    expect(text).toMatch(/^nikos migrate maps: intent\/ -> maps\/ht\/ under group PAY \(dry run: nothing written\)/);
    expect(text).toContain("intent/storymap.yaml");
    expect(text).toContain("(bet: checkout-speed");
    expect(text).toContain("planning/plan.yaml");
    expect(text).toContain("level team -> group, key PAY (name and pillars kept, period Q4 2026)");
    expect(text).toMatch(/maps\/ht\/assignments\.yaml\s+team "hello-todo", repo "\."/);
    expect(text).toContain("Ids (--rename-ids): 4 ids");
    expect(text).toContain("HT-1 -> PAY-HT-1");
    expect(text).toContain("ticket values kept: PAY-123");
    expect(text).toContain("CODEOWNERS: /intent/approvals/ -> /maps/ht/approvals/");
    expect(text).toContain("intent/tmp/ isn't a moved file");
  });

  it("a dry run writes nothing: the tree is the same, byte for byte, and nothing branches", async () => {
    const dir = legacyRepo();
    const before = hashOf(dir);
    await migrateMaps(dir, { ...yes, dryRun: true });
    expect(hashOf(dir)).toBe(before);
    expect(git(dir, "branch", "--list", "nikos/migrate-maps")).toBe("");
  });

  it("a team plan without key results is rewritten to a group, keeping its name, pillars and period", async () => {
    const dir = legacyRepo();
    const plan = planMapsMigration(dir, { key: "HT", group: "PAY", bet: "checkout-speed", stub: false, renameIds: true, period: "Q4 2026", name: "Hello Todo", team: "hello-todo" });
    const text = parse(plan.files.get("planning/plan.yaml")!);
    expect(text).toMatchObject({ name: "Hello Todo", key: "PAY", period: "Q4 2026", level: "group", pillars: ["Focus"] });
    expect(plan.plan).toBe("team-to-group");
  });

  it("a group plan that already has the key is kept as it is", async () => {
    const dir = legacyRepo({ plan: "name: Checkout\nkey: PAY\nperiod: Q4 2026\nlevel: group\npillars: []\n" });
    const plan = planMapsMigration(dir, { key: "HT", group: "PAY", bet: "checkout-speed", stub: false, renameIds: true, period: "Q4 2026", name: "Checkout", team: "hello-todo" });
    expect(plan.plan).toBe("keep");
    expect(plan.files.has("planning/plan.yaml")).toBe(false);
  });

  it("with one local bet named, it's the map's bet; cross-repo links are dropped with a warning", async () => {
    const storymap = STORYMAP.replace("bets: [checkout-speed]", "bets: [checkout-speed, acme/payments#one-tap-pay]");
    const dir = legacyRepo({ storymap });
    const r = await migrateMaps(dir, { ...yes, dryRun: true });
    const text = r.lines.join("\n");
    expect(text).toContain("bet: checkout-speed; bets: and story_bets: dropped");
    expect(text).toContain("dropped bet links: release 1 names acme/payments#one-tap-pay: a bet in another repo can't be named here, so it's dropped");
  });

  it("with no local bet and --bet, the flag is used and the bet file must exist", async () => {
    const dir = legacyRepo({ storymap: STORYMAP.replace("    bets: [checkout-speed]\n", "") });
    const r = await migrateMaps(dir, { ...yes, bet: "checkout-speed", dryRun: true });
    expect(r.lines.join("\n")).toContain("(bet: checkout-speed)");
    const e = await refusal(migrateMaps(dir, { ...yes, bet: "nope", dryRun: true }));
    expect(e.message).toBe("planning/bets/nope.md doesn't exist: create it, or pass --new-bet nope to make a stub.");
  });

  it("--new-bet writes a stub bet card that validates", async () => {
    const dir = legacyRepo({ storymap: STORYMAP.replace("    bets: [checkout-speed]\n", "") });
    const before = hashOf(dir);
    const plan = planMapsMigration(dir, { key: "HT", group: "PAY", bet: "faster-checkout", stub: true, renameIds: true, period: "Q4 2026", name: "Hello Todo", team: "hello-todo" });
    expect(hashOf(dir)).toBe(before);
    expect(plan.files.get("planning/bets/faster-checkout.md")).toContain("id: faster-checkout");
    expect(plan.creates).toContain("planning/bets/faster-checkout.md");
  });

  it("a target that fails the group's checks is refused, and the real tree is untouched", async () => {
    // A group bet aimed at a plan that isn't the one above it: validate refuses it at group level.
    const dir = legacyRepo({ bets: { "checkout-speed": BET("checkout-speed", "acme/company-plan#one-tap-pay") } });
    const before = hashOf(dir);
    const e = await refusal(migrateMaps(dir, { ...yes }));
    expect(e.message).toMatch(/^The new layout fails its checks, so nothing was written:\n {2}planning\/bets\/checkout-speed\.md: acme\/company-plan#one-tap-pay: acme\/company-plan isn't the plan directly above this one/);
    expect(hashOf(dir)).toBe(before);
  });
});

describe("applying the plan", () => {
  it("moves the map, renames ids, keeps approvals and tags, and leaves no intent/", async () => {
    const dir = legacyRepo();
    await migrateMaps(dir, { ...yes });
    expect(existsSync(join(dir, "intent"))).toBe(false);
    const story = readFileSync(join(dir, "maps/ht/storymap.yaml"), "utf8");
    expect(story).toContain("bet: checkout-speed");
    expect(story).toContain("stories: [PAY-HT-1, PAY-HT-2, PAY-HT-12]");
    expect(story).not.toContain("bets:");
    const feat = readFileSync(join(dir, "maps/ht/features/tasks/reorder-tasks.feature"), "utf8");
    expect(feat.split("\n")[0]).toBe("@PAY-HT-2 @release-1 @must @activity-tasks @depends-PAY-HT-1");
    expect(readFileSync(join(dir, "maps/ht/state/PAY-HT-2.yaml"), "utf8")).toContain("ticket: PAY-123");
    expect(existsSync(join(dir, "maps/ht/state/PAY-HT-1.yaml"))).toBe(true);
    expect(readFileSync(join(dir, "maps/ht/approvals/PAY-HT-1.yaml"), "utf8")).toContain("by: Ada Lovelace");
    expect(readFileSync(join(dir, "maps/ht/plans/PAY-HT-12.v1.md"), "utf8")).toContain("PAY-HT-12 plan");
    expect(readFileSync(join(dir, "maps/ht/assignments.yaml"), "utf8")).toContain("repo: .");
    expect(readFileSync(join(dir, "planning/decisions.md"), "utf8")).toContain("(PAY-HT-12)");
  });

  it("the migrated repo passes validate, planning validate and the group's own checks, and the approval still holds", async () => {
    const dir = legacyRepo();
    await migrateMaps(dir, { ...yes, commit: true });
    expect(validateGroup(dir).errors).toEqual([]);
    expect(validate(dir).errors).toEqual([]);
    expect(planningIssues(dir).filter((i) => !i.warning)).toEqual([]);
    expect(validateGroup(dir).warnings.map((w) => w.message).join(" ")).not.toMatch(/approval|lapse|changed/i);
    const d = doctor(dir, { offline: true });
    expect(d.some((c) => c.status === "fail")).toBe(false);
  });

  it("the runner, CODEOWNERS and .gitignore follow the move; .gitignore's other lines are reported", async () => {
    const dir = legacyRepo();
    const r = await migrateMaps(dir, { ...yes });
    expect(readFileSync(join(dir, "cucumber.mjs"), "utf8")).toContain('"maps/ht/features/**/*.feature"');
    expect(readFileSync(join(dir, "CODEOWNERS"), "utf8")).toBe("/maps/ht/approvals/ @acme/pm\n/maps/ht/features/ @acme/qa\n/src/ @acme/dev\n");
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("node_modules/\nintent/tmp/\n");
    expect(r.lines.join("\n")).toContain(".gitignore: intent/tmp/ isn't a moved file, so it's not changed");
  });

  it("intent/decisions.md moves to planning/decisions.md when there is none there", async () => {
    const plain = legacyRepo();
    await migrateMaps(plain, { ...yes });
    expect(readFileSync(join(plain, "planning/decisions.md"), "utf8")).toContain("## 2026-10-01 — chose a list (PAY-HT-12)");
  });

  it("without --rename-ids the migration is refused, so intent/decisions.md stays where it is", async () => {
    const kept = legacyRepo();
    const e = await refusal(migrateMaps(kept, { yes: true, groupKey: "PAY", period: "Q4 2026", team: "hello-todo" }));
    expect(e.message).toMatch(/^\d+ story ids don't carry the group key/);
    expect(existsSync(join(kept, "intent/decisions.md"))).toBe(true);
  });

  it("--commit commits only the paths it wrote, including the removals from intent/", async () => {
    const dir = legacyRepo();
    const headBefore = git(dir, "rev-parse", "HEAD");
    const r = await migrateMaps(dir, { ...yes, commit: true });
    expect(r.committed).toBe(true);
    expect(git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("nikos/migrate-maps");
    const files = git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    expect(files.every((f) => f.startsWith("maps/") || f.startsWith("planning/") || f.startsWith("intent/") || f === "cucumber.mjs" || f === "CODEOWNERS" || f === ".gitignore")).toBe(true);
    expect(git(dir, "ls-tree", "-r", "--name-only", "HEAD").split("\n").some((f) => f.startsWith("intent/"))).toBe(false);
    expect(files.length).toBeGreaterThan(5);
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(git(dir, "log", "-1", "--format=%s")).toBe("Migrate intent/ to maps/ht/ (nikos migrate maps)");
    expect(git(dir, "rev-parse", "HEAD")).not.toBe(headBefore);
  });

  it("without --commit the changes are left uncommitted on the branch, and the branch exists", async () => {
    const dir = legacyRepo();
    const head = git(dir, "rev-parse", "HEAD");
    const r = await migrateMaps(dir, { ...yes });
    expect(r.committed).toBeUndefined();
    expect(git(dir, "rev-parse", "HEAD")).toBe(head);
    expect(git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("nikos/migrate-maps");
    expect(git(dir, "status", "--porcelain")).not.toBe("");
    expect(r.lines.join("\n")).toContain("Review the changes, then commit: git add -A && git commit.");
  });

  it("with no git identity, --commit fails, the changes stay, and the message says so", async () => {
    const dir = legacyRepo();
    const saved = { ...process.env };
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "user.useConfigOnly";
    process.env.GIT_CONFIG_VALUE_0 = "true";
    delete process.env.GIT_AUTHOR_NAME;
    delete process.env.GIT_AUTHOR_EMAIL;
    delete process.env.GIT_COMMITTER_NAME;
    delete process.env.GIT_COMMITTER_EMAIL;
    process.env.HOME = mkdtempSync(join(tmpdir(), "nikos-home-"));
    try {
      const e = await refusal(migrateMaps(dir, { ...yes, commit: true }));
      expect(e.message).toMatch(/^The changes are in place but not committed: /);
      expect(e.message).toMatch(/Commit them with git add -A && git commit\.$/);
      expect(existsSync(join(dir, "maps/ht/storymap.yaml"))).toBe(true);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  it("the second run is refused, since maps/ now exists", async () => {
    const dir = legacyRepo();
    await migrateMaps(dir, { ...yes, commit: true });
    expect((await refusal(migrateMaps(dir, { ...yes }))).message).toBe("This repo already has maps/. Migrate needs a repo with intent/ and no maps/.");
  });

  it("without --rename-ids the migration is refused, and nothing is written", async () => {
    const dir = legacyRepo();
    const before = hashOf(dir);
    const e = await refusal(migrateMaps(dir, { yes: true, groupKey: "PAY", period: "Q4 2026", team: "hello-todo" }));
    expect(e.code).toBe(1);
    expect(hashOf(dir)).toBe(before);
  });

  it("a team repo joins the migrated group and reads its one assigned map", async () => {
    const dir = legacyRepo();
    await migrateMaps(dir, { ...yes, commit: true });
    // The group's main branch is what a team reads: merge the migration first, as the person would.
    git(dir, "switch", "-q", "main");
    git(dir, "merge", "-q", "--ff-only", "nikos/migrate-maps");
    const team = mkdtempSync(join(tmpdir(), "nikos-team-after-"));
    teamInit(team, { repo: "acme/hello-todo-web", name: "Hello web" });
    const joined = teamJoin(team, "acme/hello-todo", { url: dir });
    expect(joined.stories).toBe(0);
    expect(joined.unresolved).toBeUndefined();
  });

  it("the plan names each file it creates: the plan, a stub bet, and the group's assignment", () => {
    const dir = legacyRepo({ storymap: STORYMAP.replace("    bets: [checkout-speed]\n", "") });
    const plan = planMapsMigration(dir, { key: "HT", group: "PAY", bet: "faster-checkout", stub: true, renameIds: true, period: "Q4 2026", name: "Hello Todo", team: "hello-todo" });
    const text = renderPlan(plan, true).join("\n");
    expect(text).toMatch(/^nikos migrate maps: intent\/ -> maps\/ht\/ under group PAY \(dry run: nothing written\)$/m);
    expect(text).toMatch(/^  planning\/plan\.yaml\s+level team -> group, key PAY \(name and pillars kept, period Q4 2026\)$/m);
    expect(text).toMatch(/^  planning\/bets\/faster-checkout\.md\s+\(stub, from --new-bet\)$/m);
    expect(text).toMatch(/^  maps\/ht\/assignments\.yaml\s+team "hello-todo", repo "\."$/m);
  });
});

describe("the apply path, directly", () => {
  it("writes the layout and leaves no intent/ when the check passes", () => {
    const dir = legacyRepo();
    const plan = planMapsMigration(dir, { key: "HT", group: "PAY", bet: "checkout-speed", stub: false, renameIds: true, period: "Q4 2026", name: "Hello Todo", team: "t" });
    expect(targetProblems(dir, plan)).toEqual([]);
    applyMapsPlan(dir, plan, { git: true });
    expect(existsSync(join(dir, "maps/ht/assignments.yaml"))).toBe(true);
    expect(existsSync(join(dir, "intent"))).toBe(false);
  });
});

describe("the wizard, the template and the team path", () => {
  it("the behave template keeps its intent/ line, which a 0.2.x repo runs", () => {
    const text = readFileSync(join(__dirname, "../templates/verify/python/behave.ini"), "utf8");
    expect(text).toContain("maps/");
    expect(text).toContain("paths = intent/features");
    expect(text).not.toMatch(/paths = .*\*/);
  });

  it("nikos verify setup in a group repo lists the folder of each map, and no intent/ folder", () => {
    const dir = groupRepo("PAY");
    write(join(dir, "requirements.txt"), "behave\n");
    setupVerify(dir);
    const ini = readFileSync(join(dir, "behave.ini"), "utf8");
    expect(ini).toContain("paths =\n    maps/chk/features\n");
    expect(ini).not.toMatch(/^paths = intent/m);
  });

  it("nikos verify setup in a 0.2.x repo keeps the template's intent/features line", () => {
    const dir = legacyRepo();
    write(join(dir, "requirements.txt"), "behave\n");
    setupVerify(dir);
    expect(readFileSync(join(dir, "behave.ini"), "utf8")).toMatch(/^paths = intent\/features$/m);
  });
});

describe("what migrate touches, and what it refuses", () => {
  it("refuses a file under a moved folder that the moves don't pick up, and leaves the tree as it was", async () => {
    const dir = legacyRepo({ extra: { "intent/features/README.md": "# notes\n" } });
    const before = hashOf(dir);
    expect((await refusal(migrateMaps(dir, { ...yes }))).message).toBe("intent/features/README.md isn't a story file, so migrate doesn't move it. Move or remove it first.");
    expect(hashOf(dir)).toBe(before);
  });

  it("removes a .DS_Store and an empty folder's placeholder, both listed in the plan, and refuses any other dotfile", async () => {
    const dir = legacyRepo({ extra: { "intent/.DS_Store": "x", "intent/plans/.gitkeep": "" } });
    const text = (await migrateMaps(dir, { ...yes, dryRun: true })).lines.join("\n");
    expect(text).toMatch(/intent\/\.DS_Store\s+removed/);
    expect(text).toMatch(/intent\/plans\/\.gitkeep\s+removed/);
    await migrateMaps(dir, { ...yes });
    expect(existsSync(join(dir, "intent"))).toBe(false);
    const other = legacyRepo({ extra: { "intent/.env": "SECRET=1\n" } });
    expect((await refusal(migrateMaps(other, { ...yes }))).message).toBe("intent/ has .env, which migrate does not move. Move or remove it first.");
  });

  it("nested state and approvals keep their folder, so two files with one name don't collide", () => {
    const dir = legacyRepo({ extra: { "intent/state/archive/HT-3.yaml": "status: done\n", "intent/approvals/old/HT-1.yaml": "by: Old\n" } });
    const plan = planMapsMigration(dir, { key: "HT", group: "PAY", bet: "checkout-speed", stub: false, renameIds: true, period: "Q4 2026", name: "Hello Todo", team: "t" });
    const to = plan.moves.map((m) => m.to);
    expect(to).toContain("maps/ht/state/archive/PAY-HT-3.yaml");
    expect(to).toContain("maps/ht/state/PAY-HT-3.yaml");
    expect(to).toContain("maps/ht/approvals/old/PAY-HT-1.yaml");
    expect(new Set(to).size).toBe(to.length);
  });

  it("a named bet with no card: a non-terminal run refuses and names --new-bet, and --new-bet writes the stub and migrates", async () => {
    const dir = legacyRepo({ bets: {} });
    const e = await refusal(migrateMaps(dir, { ...yes }));
    expect(e.code).toBe(2);
    expect(e.message).toBe("planning/bets/checkout-speed.md doesn't exist: pass --new-bet checkout-speed to make a stub, or --bet <id> for an existing card.");
    expect(existsSync(join(dir, "intent"))).toBe(true);
    await migrateMaps(dir, { ...yes, newBet: "checkout-speed" });
    expect(readFileSync(join(dir, "planning/bets/checkout-speed.md"), "utf8")).toContain("id: checkout-speed");
    expect(existsSync(join(dir, "intent"))).toBe(false);
  });

  it("the plan is shown before anything is written", async () => {
    const dir = legacyRepo();
    const before = hashOf(dir);
    let shown: string[] = [];
    let treeWhenShown = "";
    const r = await migrateMaps(dir, { ...yes }, undefined, false, (lines) => {
      shown = lines;
      treeWhenShown = hashOf(dir);
    });
    expect(treeWhenShown).toBe(before);
    expect(shown.join("\n")).toContain("Moves");
    expect(r.shown).toBe(shown.length);
    expect(r.written).toBe(true);
  });

  it("a failed check puts a repo without git back, byte for byte", () => {
    const dir = legacyRepo({ noGit: true });
    const plan = planMapsMigration(dir, { key: "HT", group: "PAY", bet: "checkout-speed", stub: false, renameIds: true, period: "Q4 2026", name: "Hello Todo", team: "t" });
    plan.files.set("planning/plan.yaml", "name: [broken\n");
    const before = hashOf(dir);
    expect(() => applyMapsPlan(dir, plan, { git: false })).toThrow(/It was undone: the repo is as it was/);
    expect(hashOf(dir)).toBe(before);
  });

  it("a failed check puts a git repo back, and switches back to its branch without the migration's", () => {
    const dir = legacyRepo();
    const plan = planMapsMigration(dir, { key: "HT", group: "PAY", bet: "checkout-speed", stub: false, renameIds: true, period: "Q4 2026", name: "Hello Todo", team: "t" });
    plan.files.set("planning/plan.yaml", "name: [broken\n");
    const before = hashOf(dir);
    expect(() => applyMapsPlan(dir, plan, { git: true, branch: "nikos/migrate-maps" })).toThrow("It was undone");
    expect(hashOf(dir)).toBe(before);
    expect(git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(dir, "branch", "--list", "nikos/migrate-maps")).toBe("");
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("a team plan without a period takes the period it's given", () => {
    const dir = legacyRepo({ plan: "name: Hello Todo\nlevel: team\npillars: [Focus]\n" });
    const plan = planMapsMigration(dir, { key: "HT", group: "PAY", bet: "checkout-speed", stub: false, renameIds: true, period: "Q1 2027", name: "Hello Todo", team: "t" });
    expect(parse(plan.files.get("planning/plan.yaml")!)).toMatchObject({ period: "Q1 2027", key: "PAY", level: "group" });
  });

  it("a flag that disagrees with the plan's own period is refused, not dropped", async () => {
    const dir = legacyRepo({ plan: "name: Checkout\nkey: PAY\nperiod: Q4 2026\nlevel: group\npillars: []\n" });
    const e = await refusal(migrateMaps(dir, { ...yes, period: "Q1 2027" }));
    expect(e.code).toBe(2);
    expect(e.message).toBe('planning/plan.yaml\'s period is "Q4 2026", not "Q1 2027". Change the plan, or drop --period.');
  });

  it("every runner file that names intent/features is rewritten, not just the first", async () => {
    const dir = legacyRepo({ extra: { "behave.ini": "[behave]\npaths = intent/features\n" } });
    await migrateMaps(dir, { ...yes });
    expect(readFileSync(join(dir, "behave.ini"), "utf8")).toBe("[behave]\npaths = maps/ht/features\n");
    expect(readFileSync(join(dir, "cucumber.mjs"), "utf8")).toContain('"maps/ht/features/**/*.feature"');
  });

  it("an unknown --option is named, so a typo can't pass for a flag", () => {
    expect(unknownFlags(["--dry-run", "--rename-id", "--yes"])).toEqual(["--rename-id"]);
    expect(unknownFlags(["--dir", "x", "--group-key", "PAY", "--rename-ids", "--no-branch"])).toEqual([]);
  });

  it("without git the migration writes, and --commit is refused as a usage error", async () => {
    const dir = legacyRepo({ noGit: true });
    expect((await refusal(migrateMaps(dir, { ...yes, commit: true }))).code).toBe(2);
    expect(existsSync(join(dir, "intent"))).toBe(true);
    await migrateMaps(dir, { ...yes });
    expect(existsSync(join(dir, "maps/ht/storymap.yaml"))).toBe(true);
    expect(existsSync(join(dir, "intent"))).toBe(false);
  });
});
