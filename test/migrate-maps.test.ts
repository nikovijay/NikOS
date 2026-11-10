// `nikos migrate maps`: a 0.2.x intent/ moves to maps/<key>/. The fixture is a realistic 0.2.x repo: a
// story map with four stories, per-story state and an approval, features with tags, a plan, a
// decision, CODEOWNERS, .gitignore and a cucumber config.
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
import { validate } from "../src/commands/validate";
import { git, groupRepo, write } from "./repo-fixture";
import { setupVerify } from "../src/commands/verify";
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

/** A plan with the key the story ids take: ids are renamed to PAY-HT-n. */
const KEYED_PLAN = "name: Hello Todo\nkey: PAY\nperiod: Q4 2026\nlevel: group\npillars: [Focus]\n";
/** A plan with no key: the ids stay HT-n. */
const NO_KEY_PLAN = "name: Hello Todo\nperiod: Q4 2026\nlevel: team\npillars: [Focus]\n";

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
  if (o.plan !== null) write(join(dir, "planning/plan.yaml"), o.plan ?? KEYED_PLAN);
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

const yes = { yes: true };

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

  it("refuses a root decisions.md that differs from intent/decisions.md, and merges nothing", async () => {
    const dir = legacyRepo({ extra: { "decisions.md": "# Other decisions\n" } });
    const before = hashOf(dir);
    expect((await refusal(migrateMaps(dir, yes))).message).toBe("decisions.md at the repo root and intent/decisions.md both exist, and they differ. Merge them by hand, then retry.");
    expect(hashOf(dir)).toBe(before);
  });

  it("refuses a story map the migrated layout fails to check, and moves nothing", async () => {
    const dir = legacyRepo({ storymap: STORYMAP.replace("format_version: 1", "format_version: 2") });
    const e = await refusal(migrateMaps(dir, yes));
    expect(e.message).toMatch(/^The new layout fails its checks, so nothing was written:\n {2}maps\/ht\/storymap\.yaml: /);
    expect(existsSync(join(dir, "intent/storymap.yaml"))).toBe(true);
    expect(existsSync(join(dir, "maps"))).toBe(false);
  });

  it("a non-terminal run without --yes or --dry-run is a usage error, and writes nothing", async () => {
    const dir = legacyRepo();
    const before = hashOf(dir);
    const e = await refusal(migrateMaps(dir, {}));
    expect(e.code).toBe(2);
    expect(e.message).toMatch(/^Nothing written: this isn't a terminal, so pass --yes/);
    expect(hashOf(dir)).toBe(before);
  });

  it("--new-bet without a planning/ folder is a usage error, since the card has nowhere to go", async () => {
    const dir = legacyRepo({ plan: null, bets: {} });
    const e = await refusal(migrateMaps(dir, { ...yes, newBet: "faster-checkout" }));
    expect(e.code).toBe(2);
    expect(e.message).toMatch(/^--new-bet needs a planning\/ folder/);
  });

  it("a named bet with no card, in a repo with planning/, is a usage error that names --new-bet", async () => {
    const dir = legacyRepo({ bets: {} });
    const e = await refusal(migrateMaps(dir, { ...yes }));
    expect(e.code).toBe(2);
    expect(e.message).toBe("planning/bets/checkout-speed.md doesn't exist: pass --new-bet checkout-speed to make a stub, or write the card by hand, then retry.");
    expect(existsSync(join(dir, "intent"))).toBe(true);
  });
});

describe("the plan", () => {
  it("prints the moves, the folds, the ids and what to check by hand", async () => {
    const dir = legacyRepo({ storymap: `${STORYMAP}story_bets:\n  HT-1: [checkout-speed]\n` });
    const r = await migrateMaps(dir, { ...yes, dryRun: true });
    const text = r.lines.join("\n");
    expect(r.written).toBe(false);
    expect(text).toMatch(/^nikos migrate maps: intent\/ -> maps\/ht\/ \(dry run: nothing written\)/);
    expect(text).toContain("intent/storymap.yaml");
    expect(text).toContain("(bet: checkout-speed; bets: and story_bets: dropped)");
    expect(text).toMatch(/intent\/state\/HT-1\.yaml\s+-> maps\/ht\/state\.yaml \(merged into stories\)/);
    expect(text).toMatch(/intent\/approvals\/ \(1 file\)\s+-> maps\/ht\/approvals\//);
    expect(text).not.toContain("planning/plan.yaml");
    expect(text).not.toContain("assignments.yaml");
    expect(text).toContain("Ids (the plan's key PAY): 4 ids");
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

  it("with one local bet named and its card in planning/, it's the map's bet; cross-repo links are dropped with a warning", async () => {
    const storymap = STORYMAP.replace("bets: [checkout-speed]", "bets: [checkout-speed, acme/payments#one-tap-pay]");
    const dir = legacyRepo({ storymap });
    const r = await migrateMaps(dir, { ...yes, dryRun: true });
    const text = r.lines.join("\n");
    expect(text).toContain("(bet: checkout-speed; bets: and story_bets: dropped)");
    expect(text).toContain("dropped bet links: release 1 names acme/payments#one-tap-pay: a bet in another repo can't be named here, so it's dropped");
  });

  it("a bet named with no planning/ folder is dropped and listed, and the map names no bet", async () => {
    const dir = legacyRepo({ plan: null, bets: {} });
    const r = await migrateMaps(dir, { ...yes, dryRun: true });
    const text = r.lines.join("\n");
    expect(text).toContain("(no bet; bets: and story_bets: dropped)");
    expect(text).toContain("dropped bet links: release 1 names checkout-speed: a map names one bet, in bet:, so this link is dropped");
    expect(text).not.toContain("Creates");
  });

  it("--new-bet writes a stub card that validates, and the map names it", async () => {
    const dir = legacyRepo({ storymap: STORYMAP.replace("    bets: [checkout-speed]\n", "") });
    const before = hashOf(dir);
    const plan = planMapsMigration(dir, { key: "HT", bet: "faster-checkout", stub: true });
    expect(hashOf(dir)).toBe(before);
    expect(plan.files.get("planning/bets/faster-checkout.md")).toContain("id: faster-checkout");
    expect(plan.creates).toContain("planning/bets/faster-checkout.md");
    expect(plan.files.get("maps/ht/storymap.yaml")).toContain("bet: faster-checkout");
    expect(renderPlan(plan, true).join("\n")).toMatch(/^  planning\/bets\/faster-checkout\.md\s+\(stub, from --new-bet\)$/m);
  });
});

describe("applying the plan", () => {
  it("moves the map, renames ids to the plan's key, folds the state, keeps approvals and tags, and leaves no intent/", async () => {
    const dir = legacyRepo();
    await migrateMaps(dir, { ...yes });
    expect(existsSync(join(dir, "intent"))).toBe(false);
    const story = readFileSync(join(dir, "maps/ht/storymap.yaml"), "utf8");
    expect(story).toContain("bet: checkout-speed");
    expect(story).toContain("stories: [PAY-HT-1, PAY-HT-2, PAY-HT-12]");
    expect(story).not.toContain("bets:");
    const feat = readFileSync(join(dir, "maps/ht/features/tasks/reorder-tasks.feature"), "utf8");
    expect(feat.split("\n")[0]).toBe("@PAY-HT-2 @release-1 @must @activity-tasks @depends-PAY-HT-1");
    const state = parse(readFileSync(join(dir, "maps/ht/state.yaml"), "utf8"));
    expect(Object.keys(state.stories).sort()).toEqual(["PAY-HT-1", "PAY-HT-12", "PAY-HT-2", "PAY-HT-3"]);
    expect(state.stories["PAY-HT-2"]).toMatchObject({ status: "in_progress", ticket: "PAY-123" });
    expect(existsSync(join(dir, "maps/ht/state"))).toBe(false);
    expect(readFileSync(join(dir, "maps/ht/approvals/PAY-HT-1.yaml"), "utf8")).toContain("by: Ada Lovelace");
    expect(readFileSync(join(dir, "maps/ht/plans/PAY-HT-12.v1.md"), "utf8")).toContain("PAY-HT-12 plan");
    expect(existsSync(join(dir, "maps/ht/assignments.yaml"))).toBe(false);
    expect(readFileSync(join(dir, "decisions.md"), "utf8")).toContain("(PAY-HT-12)");
    // The plan itself is not rewritten: the key is already there, and nothing else is changed.
    expect(readFileSync(join(dir, "planning/plan.yaml"), "utf8")).toBe(KEYED_PLAN);
  });

  it("the migrated repo passes validate and doctor, and the approval still holds", async () => {
    const dir = legacyRepo();
    await migrateMaps(dir, { ...yes, commit: true });
    expect(validate(dir).errors).toEqual([]);
    expect(validate(dir).warnings.map((w) => w.message).join(" ")).not.toMatch(/approval|lapse|changed/i);
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

  it("intent/constitution.md and intent/decisions.md land at the repo root, not in the map", async () => {
    const dir = legacyRepo();
    await migrateMaps(dir, { ...yes });
    expect(readFileSync(join(dir, "constitution.md"), "utf8")).toContain("# ");
    expect(readFileSync(join(dir, "decisions.md"), "utf8")).toContain("## 2026-10-01 — chose a list (PAY-HT-12)");
    expect(existsSync(join(dir, "maps/ht/constitution.md"))).toBe(false);
    expect(existsSync(join(dir, "maps/ht/decisions.md"))).toBe(false);
    expect(existsSync(join(dir, "planning/decisions.md"))).toBe(false);
  });

  it("with no planning/plan.yaml, no plan is created, and the ids stay as they are", async () => {
    const dir = legacyRepo({ plan: null, bets: {} });
    await migrateMaps(dir, { ...yes });
    expect(existsSync(join(dir, "planning"))).toBe(false);
    const story = readFileSync(join(dir, "maps/ht/storymap.yaml"), "utf8");
    expect(story).toContain("stories: [HT-1, HT-2, HT-12]");
    expect(story).not.toContain("bet:");
    expect(readFileSync(join(dir, "maps/ht/state.yaml"), "utf8")).toContain("HT-2:");
    expect(readFileSync(join(dir, "maps/ht/approvals/HT-1.yaml"), "utf8")).toContain("by: Ada Lovelace");
    expect(validate(dir).errors).toEqual([]);
  });

  it("with a plan that has no key, ids are not renamed; with a key, they are", async () => {
    const solo = legacyRepo({ plan: NO_KEY_PLAN });
    const soloPlan = planMapsMigration(solo, { key: "HT", stub: false });
    expect(soloPlan.renames).toEqual([]);
    expect(soloPlan.prefix).toBeUndefined();
    const keyed = legacyRepo({ plan: KEYED_PLAN });
    const keyedPlan = planMapsMigration(keyed, { key: "HT", stub: false });
    expect(keyedPlan.renames).toEqual([["HT-1", "PAY-HT-1"], ["HT-2", "PAY-HT-2"], ["HT-12", "PAY-HT-12"], ["HT-3", "PAY-HT-3"]]);
    expect(keyedPlan.prefix).toBe("PAY");
  });

  it("the migrated repo with no plan key validates, with the ids as they were", async () => {
    const dir = legacyRepo({ plan: NO_KEY_PLAN });
    await migrateMaps(dir, { ...yes, commit: true });
    expect(validate(dir).errors).toEqual([]);
    expect(readFileSync(join(dir, "maps/ht/storymap.yaml"), "utf8")).toContain("stories: [HT-1, HT-2, HT-12]");
  });

  it("the state of each story and each approval is in the one file: state.yaml and approvals/<ID>.yaml", async () => {
    const add3 = feature("HT-3", 2, "tasks", "See the top three");
    const dir = legacyRepo({
      extra: { "intent/approvals.yaml": `format_version: 1\napprovals:\n  HT-3:\n    by: Grace Hopper\n    on: 2026-10-03\n    spec_hash: ${specHash(add3)}\n    done_at: 2026-10-03\n` },
    });
    await migrateMaps(dir, { ...yes });
    expect(existsSync(join(dir, "maps/ht/approvals.yaml"))).toBe(false);
    expect(readFileSync(join(dir, "maps/ht/approvals/PAY-HT-3.yaml"), "utf8")).toContain("by: Grace Hopper");
    expect(readFileSync(join(dir, "maps/ht/approvals/PAY-HT-1.yaml"), "utf8")).toContain("by: Ada Lovelace");
    expect(validate(dir).errors).toEqual([]);
  });

  it("--commit commits only the paths it wrote, including the removals from intent/", async () => {
    const dir = legacyRepo();
    const headBefore = git(dir, "rev-parse", "HEAD");
    const r = await migrateMaps(dir, { ...yes, commit: true });
    expect(r.committed).toBe(true);
    expect(git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("nikos/migrate-maps");
    const files = git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    expect(files.every((f) => f.startsWith("maps/") || f.startsWith("planning/") || f.startsWith("intent/") || ["cucumber.mjs", "CODEOWNERS", ".gitignore", "constitution.md", "decisions.md"].includes(f))).toBe(true);
    expect(files).toContain("decisions.md");
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

  it("--new-bet writes the stub card in planning/bets and the map names it, once migrated", async () => {
    const dir = legacyRepo({ storymap: STORYMAP.replace("    bets: [checkout-speed]\n", ""), bets: {} });
    await migrateMaps(dir, { ...yes, newBet: "faster-checkout" });
    expect(readFileSync(join(dir, "planning/bets/faster-checkout.md"), "utf8")).toContain("id: faster-checkout");
    expect(readFileSync(join(dir, "maps/ht/storymap.yaml"), "utf8")).toContain("bet: faster-checkout");
    expect(existsSync(join(dir, "intent"))).toBe(false);
  });
});

describe("the apply path, directly", () => {
  it("writes the layout and leaves no intent/ when the check passes", () => {
    const dir = legacyRepo();
    const plan = planMapsMigration(dir, { key: "HT", bet: "checkout-speed", stub: false });
    expect(targetProblems(dir, plan)).toEqual([]);
    applyMapsPlan(dir, plan, { git: true });
    expect(existsSync(join(dir, "maps/ht/assignments.yaml"))).toBe(false);
    expect(existsSync(join(dir, "intent"))).toBe(false);
  });
});

describe("the wizard and the template", () => {
  it("nikos verify setup in a group repo lists the folder of each map, and no intent/ folder", () => {
    const dir = groupRepo("PAY");
    write(join(dir, "requirements.txt"), "behave\n");
    setupVerify(dir);
    const ini = readFileSync(join(dir, "behave.ini"), "utf8");
    expect(ini).toContain("paths =\n    maps/chk/features\n");
    expect(ini).not.toMatch(/^paths = intent/m);
  });
});

describe("what migrate touches, and what it refuses", () => {
  it("refuses a file under a moved folder that the moves don't pick up, and leaves the tree as it was", async () => {
    const dir = legacyRepo({ extra: { "intent/features/README.md": "# notes\n" } });
    const before = hashOf(dir);
    expect((await refusal(migrateMaps(dir, { ...yes }))).message).toBe("intent/features/README.md isn't a story file, so migrate doesn't move it. Move or remove it first.");
    expect(hashOf(dir)).toBe(before);
  });

  it("refuses a nested state file, since state is one file per map, and moves nothing", async () => {
    const dir = legacyRepo({ extra: { "intent/state/archive/HT-3.yaml": "status: done\n" } });
    const before = hashOf(dir);
    expect((await refusal(migrateMaps(dir, { ...yes }))).message).toBe("intent/state/archive/HT-3.yaml isn't a story file, so migrate doesn't move it. Move or remove it first.");
    expect(hashOf(dir)).toBe(before);
  });

  it("refuses a nested approval file the same way", async () => {
    const dir = legacyRepo({ extra: { "intent/approvals/old/HT-1.yaml": "by: Old\n" } });
    expect((await refusal(migrateMaps(dir, { ...yes }))).message).toBe("intent/approvals/old/HT-1.yaml isn't a story file, so migrate doesn't move it. Move or remove it first.");
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
    const plan = planMapsMigration(dir, { key: "HT", bet: "checkout-speed", stub: false });
    plan.files.set("maps/ht/storymap.yaml", "key: [broken\n");
    const before = hashOf(dir);
    expect(() => applyMapsPlan(dir, plan, { git: false })).toThrow(/It was undone: the repo is as it was/);
    expect(hashOf(dir)).toBe(before);
  });

  it("a failed check puts a git repo back, and switches back to its branch without the migration's", () => {
    const dir = legacyRepo();
    const plan = planMapsMigration(dir, { key: "HT", bet: "checkout-speed", stub: false });
    plan.files.set("maps/ht/storymap.yaml", "key: [broken\n");
    const before = hashOf(dir);
    expect(() => applyMapsPlan(dir, plan, { git: true, branch: "nikos/migrate-maps" })).toThrow("It was undone");
    expect(hashOf(dir)).toBe(before);
    expect(git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(dir, "branch", "--list", "nikos/migrate-maps")).toBe("");
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("every runner file that names intent/features is rewritten, not just the first", async () => {
    const dir = legacyRepo({ extra: { "behave.ini": "[behave]\npaths = intent/features\n" } });
    await migrateMaps(dir, { ...yes });
    expect(readFileSync(join(dir, "behave.ini"), "utf8")).toBe("[behave]\npaths = maps/ht/features\n");
    expect(readFileSync(join(dir, "cucumber.mjs"), "utf8")).toContain('"maps/ht/features/**/*.feature"');
  });

  it("an unknown --option is named, so a typo can't pass for a flag, and the retired flags are unknown too", () => {
    expect(unknownFlags(["--dry-run", "--rename-id", "--yes"])).toEqual(["--rename-id"]);
    expect(unknownFlags(["--dir", "x", "--key", "HT", "--no-branch"])).toEqual([]);
    expect(unknownFlags(["--group-key", "PAY", "--rename-ids", "--bet", "checkout-speed"])).toEqual(["--group-key", "--rename-ids", "--bet"]);
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
