// nikos migrate maps in a team repo (rule 6): a team's intent/ moves into its own maps/<key>/ in place,
// with the team key, its home and its bet asked for (or given as flags), and the team file gets the key
// and home it lacked. The same plan-first, copy-checked, reversible flow as for a group.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { MigrateError, migrateMaps } from "../src/commands/migrate-maps";
import { validate } from "../src/commands/validate";
import { git, write, commitAll } from "./team-fixture";

const STORYMAP = `format_version: 1
project: hello-todo
key: HT
activities:
  - id: tasks
    title: Manage tasks
releases:
  - number: 1
    title: MVP
    stories: [HT-1, HT-2]
`;
const feature = (id: string, title: string) =>
  `@${id} @release-1 @must @activity-tasks\nFeature: ${title}\n\n  As a person\n  I want ${title.toLowerCase()}\n  So that I keep my list\n\n  @AC1 @must\n  Scenario: AC1 — ${title}\n    Given an empty list\n    When I add "Buy milk"\n    Then I see "Buy milk"\n`;
const BET = `---\nid: checkout-speed\nowner: Product\nhypothesis: Faster checkout keeps people paying.\nkrs:\n  also: []\nreview_on: 2027-01-15\nconfidence: medium\ndependencies: []\noutcome: open\nreviews: []\n---\n\n## Why we think so\nTesters said checkout is slow.\n`;

/** A team repo that still holds a 0.3.0-era intent/ map, with a key-less team file and one joined plan (its home candidate). */
function teamWithIntent(teamFile = "format_version: 1\nname: Web team\nrepo: acme/web-team\ngroups: []\nmembers: []\n"): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-mig-team-"));
  write(join(dir, "intent/storymap.yaml"), STORYMAP);
  write(join(dir, "intent/features/tasks/add-task.feature"), feature("HT-1", "Add a task"));
  write(join(dir, "intent/features/tasks/keep-note.feature"), feature("HT-2", "Keep a note"));
  write(join(dir, "intent/state.yaml"), "format_version: 1\nstories:\n  HT-1: { status: todo }\n  HT-2: { status: todo }\n");
  write(join(dir, "nikos.team.yaml"), teamFile);
  write(join(dir, "planning/bets/checkout-speed.md"), BET);
  write(join(dir, "planning/upstream.yaml"), "- repo: acme/payments-group\n  url: https://example.test/acme/payments-group.git\n");
  write(join(dir, "package.json"), '{"name":"web","private":true}\n');
  git(dir, "init", "-q", "-b", "main");
  commitAll(dir, "team with intent");
  return dir;
}

const yes = { yes: true, noBranch: true };

describe("nikos migrate maps in a team repo", () => {
  it("needs the team's key and home, and says what to pass", async () => {
    const dir = teamWithIntent();
    const err = await migrateMaps(dir, { ...yes, key: "HT", bet: "checkout-speed" }).catch((e) => e as MigrateError);
    expect((err as MigrateError).message).toMatch(/^This team repo has no key, and its own map needs one: pass --team-key WEB/);
    const noHome = await migrateMaps(dir, { ...yes, key: "HT", teamKey: "WEB", bet: "checkout-speed" }).catch((e) => e as MigrateError);
    expect((noHome as MigrateError).message).toMatch(/^This team has no home: pass --home <repo>/);
    expect(existsSync(join(dir, "intent/storymap.yaml"))).toBe(true);
  });

  it("refuses a home or a cross-repo bet the team doesn't join", async () => {
    const dir = teamWithIntent();
    const home = await migrateMaps(dir, { ...yes, key: "HT", teamKey: "WEB", home: "acme/other-group", bet: "checkout-speed" }).catch((e) => e as MigrateError);
    expect((home as MigrateError).message).toBe("acme/other-group isn't a plan this team joins: nikos join acme/other-group --home first, then retry.");
    const bet = await migrateMaps(dir, { ...yes, key: "HT", teamKey: "WEB", home: "acme/payments-group", bet: "acme/company-plan#faster" }).catch((e) => e as MigrateError);
    expect((bet as MigrateError).message).toBe("acme/company-plan isn't a plan this team joins: nikos join acme/company-plan first, then retry");
    expect(existsSync(join(dir, "intent/storymap.yaml"))).toBe(true);
  });

  it("the plan names the team key, its home and the team file's change, and writes nothing", async () => {
    const dir = teamWithIntent();
    const r = await migrateMaps(dir, { dryRun: true, key: "HT", teamKey: "WEB", home: "acme/payments-group", bet: "checkout-speed", renameIds: true });
    expect(r.lines[0]).toBe("nikos migrate maps: intent/ -> maps/ht/ under team key WEB (dry run: nothing written)");
    expect(r.lines).toContain("Changes");
    expect(r.lines.join("\n")).toContain("key WEB, home acme/payments-group added (format_version 2)");
    expect(existsSync(join(dir, "maps"))).toBe(false);
    expect(readFileSync(join(dir, "nikos.team.yaml"), "utf8")).toContain("format_version: 1");
  });

  it("moves intent/ into maps/ht with the team's ids, writes the team file, and the result validates", async () => {
    const dir = teamWithIntent();
    const r = await migrateMaps(dir, { ...yes, key: "HT", teamKey: "WEB", home: "acme/payments-group", bet: "checkout-speed", renameIds: true, team: "Web team" });
    expect(r.written).toBe(true);
    expect(existsSync(join(dir, "intent"))).toBe(false);
    const sm = parse(readFileSync(join(dir, "maps/ht/storymap.yaml"), "utf8"));
    expect(sm).toMatchObject({ key: "HT", bet: "checkout-speed" });
    expect(sm.releases[0].stories).toEqual(["WEB-HT-1", "WEB-HT-2"]);
    expect(readFileSync(join(dir, "maps/ht/features/tasks/add-task.feature"), "utf8")).toMatch(/^@WEB-HT-1 /);
    expect(parse(readFileSync(join(dir, "maps/ht/assignments.yaml"), "utf8"))).toEqual([{ team: "Web team", repo: "." }]);
    expect(parse(readFileSync(join(dir, "nikos.team.yaml"), "utf8"))).toMatchObject({ format_version: 2, key: "WEB", home: "acme/payments-group", name: "Web team" });
    expect(existsSync(join(dir, "planning/plan.yaml"))).toBe(false);
    expect(validate(dir).errors).toEqual([]);
    expect(r.lines.join("\n")).toContain("owns maps/ht/");
  });

  it("a team whose file already has its key and home keeps it, and an existing key must agree", async () => {
    const dir = teamWithIntent("format_version: 2\nname: Web team\nrepo: acme/web-team\nkey: WEB\nhome: acme/payments-group\ngroups: []\nmembers: []\n");
    const r = await migrateMaps(dir, { dryRun: true, key: "HT", bet: "checkout-speed", renameIds: true });
    expect(r.lines.join("\n")).not.toContain("Changes");
    const clash = await migrateMaps(dir, { dryRun: true, key: "HT", teamKey: "ACME", bet: "checkout-speed", renameIds: true }).catch((e) => e as MigrateError);
    expect((clash as MigrateError).message).toBe("nikos.team.yaml's key is WEB, not ACME: pass --team-key WEB");
  });
});

describe("a team's migrated status and approvals", () => {
  it("move to the team's own status/ and approvals/, one file per story, so the team commands read them", async () => {
    const dir = teamWithIntent();
    write(join(dir, "intent/state.yaml"), "format_version: 1\nstories:\n  HT-1: { status: in_progress }\n  HT-2: { status: todo }\n");
    commitAll(dir, "state");
    const res = await migrateMaps(dir, { ...yes, key: "HT", teamKey: "WEB", home: "acme/payments-group", bet: "checkout-speed", renameIds: true });
    expect(res).toBeDefined();
    expect(parse(readFileSync(join(dir, "status/WEB-HT-1.yaml"), "utf8"))).toMatchObject({ status: "in_progress" });
    expect(parse(readFileSync(join(dir, "status/WEB-HT-2.yaml"), "utf8"))).toMatchObject({ status: "todo" });
    // The map keeps no state of its own: the team's status is the only one.
    expect(existsSync(join(dir, "maps/ht/state.yaml"))).toBe(false);
  });
});
