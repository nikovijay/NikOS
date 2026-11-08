// Review fixes on the team amendment: canonical bet names match across repos, a format 1 team file can't
// carry a key, team show lists a team's own maps, assign refuses --repo . for another team, team join
// refuses --home, a join clashes with a key in the assigned copies, a refused join keeps a plan it didn't add,
// validate checks an own map's local bet without a bets folder, and migrate maps --help prints its usage.
import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storiesFor, canonicalBet } from "../src/lib/bets";
import { parseTeam, openTeam } from "../src/lib/team";
import { teamInit, teamShow, runTeam } from "../src/commands/team";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { assign } from "../src/commands/assign";
import { validate } from "../src/commands/validate";
import { joinPlan } from "../src/commands/join";
import { runMigrateMaps } from "../src/commands/migrate-maps";
import { git, write, commitAll, groupRepo, teamRepo } from "./team-fixture";

afterEach(() => vi.restoreAllMocks());

/** A team with key WEB and home acme/payments-group, and one own map (INB) with one story, WEB-INB-1. */
function teamWithMap(bet = "faster-checkout"): string {
  const t = mkdtempSync(join(tmpdir(), "nikos-review-team-"));
  write(join(t, "package.json"), '{"name":"web","private":true}\n');
  git(t, "init", "-q", "-b", "main");
  git(t, "remote", "add", "origin", "https://github.com/acme/web-team.git");
  teamInit(t, { repo: "acme/web-team", name: "Web team", key: "WEB" });
  write(join(t, "nikos.team.yaml"), "format_version: 2\nname: Web team\nrepo: acme/web-team\nkey: WEB\nhome: acme/payments-group\ngroups: []\nmembers: []\n");
  write(join(t, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
  commitAll(t, "team");
  newMap({ bet, key: "INB" }, t);
  newStory({ title: "Pay by card", activity: "getting-started" }, t);
  commitAll(t, "map");
  return t;
}

describe("a bet named in another repo matches the same bet here", () => {
  const map = { releases: [{ number: 1, stories: ["WEB-INB-1", "WEB-INB-2"] }], bet: "acme/company-plan#one-inbox" };
  it("a <repo>#<id> bet is found by its bare id from the repo it names", () => {
    expect(storiesFor(map, "one-inbox", "acme/company-plan")).toEqual(["WEB-INB-1", "WEB-INB-2"]);
    expect(canonicalBet("one-inbox", "acme/company-plan")).toBe("acme/company-plan#one-inbox");
  });
  it("is not found from another repo, or by a bare id with no repo to name it", () => {
    expect(storiesFor(map, "one-inbox", "acme/other-plan")).toEqual([]);
    expect(storiesFor(map, "one-inbox")).toEqual([]);
  });
});

describe("a team file's key needs format 2, as its home does", () => {
  it("refuses a key in a format 1 file, and reads one in format 2", () => {
    expect(() => parseTeam("format_version: 1\nname: Web\nrepo: acme/web\nkey: WEB\ngroups: []\nmembers: []\n")).toThrow("key needs format_version 2");
    expect(parseTeam("format_version: 2\nname: Web\nrepo: acme/web\nkey: WEB\ngroups: []\nmembers: []\n").key).toBe("WEB");
  });
});

describe("team show lists a team's own maps and its key and home", () => {
  it("names the key and home in the header, and lists each own map with its stories", () => {
    const t = teamWithMap();
    const lines = teamShow(t, { offline: true });
    expect(lines[0]).toBe("Web team (acme/web-team), key WEB, home acme/payments-group");
    expect(lines).toContain("Own maps:");
    expect(lines).toContain("  WEB-INB: 1 story");
  });
});

describe("assign in a team repo names this team for --repo .", () => {
  it("refuses another team's name with --repo .", () => {
    const t = teamWithMap();
    expect(() => assign(t, "Ledger API", { repo: ".", stories: ["WEB-INB-1"] })).toThrow("isn't this team (Web team)");
  });
  it("accepts this team's own name with --repo .", () => {
    const t = teamWithMap();
    expect(() => assign(t, "Web team", { repo: ".", stories: ["WEB-INB-1"] })).not.toThrow();
  });
});

describe("team join refuses --home", () => {
  it("says the home is set with nikos join, and writes nothing", () => {
    const t = teamRepo();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runTeam(["join", "acme/payments-group", "--home", "--dir", t])).toBe(1);
    expect(String(err.mock.calls[0][0])).toContain("a team's home is set with nikos join <plan> --home");
  });
});

describe("validate checks an own map's local bet even with no planning/bets folder", () => {
  it("reports a bet the team doesn't have", () => {
    // The map names a bet the team has; the bet is then renamed in the map and the team's bets folder removed.
    const t = teamWithMap();
    const story = join(t, "maps/inb/storymap.yaml");
    write(story, readFileSync(story, "utf8").replace("bet: faster-checkout", "bet: fastr-checkout"));
    rmSync(join(t, "planning"), { recursive: true, force: true });
    const errors = validate(t).errors.map((e) => e.message);
    expect(errors.some((m) => m.includes("names bet fastr-checkout, which has no planning/bets/fastr-checkout.md"))).toBe(true);
  });
});

describe("migrate maps --help prints its usage", () => {
  it("prints the usage and exits 0", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runMigrateMaps(["--help"])).toBe(0);
    expect(String(log.mock.calls[0][0])).toMatch(/^Usage: nikos migrate maps/);
  });
});

describe("a team's join checks its key against the groups it takes work from", () => {
  it("refuses a plan whose key a group copy already holds", () => {
    const t = teamRepo();
    teamInit(t, { repo: "acme/checkout-web", name: "Checkout web", key: "WEB" });
    write(join(t, ".nikos/assigned/acme/payments/checkout-group/planning/plan.yaml"), "name: Checkout PAY\nkey: PAY\nperiod: Q1 2027\nlevel: group\npillars: []\n");
    const pay = groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-pay-")));
    expect(() => joinPlan(t, { repo: "acme/payments-other", url: pay, home: true })).toThrow(/PAY/);
  });
});

describe("a refused join keeps the plan it didn't add", () => {
  it("leaves a plan that was already joined, and its copy, when a later re-run is refused", () => {
    const t = teamRepo();
    teamInit(t, { repo: "acme/checkout-web", name: "Checkout web", key: "WEB" });
    const grp = groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-keep-")));
    joinPlan(t, { repo: "acme/payments-group", url: grp, home: true });
    expect(openTeam(t).home).toBe("acme/payments-group");
    // The group now names a key the chain already holds: a re-run is refused, and the copy it already had stays.
    write(join(grp, "planning/plan.yaml"), "name: Checkout CO\nkey: CO\nperiod: Q1 2027\nlevel: group\npillars: []\n");
    commitAll(grp, "rekey");
    write(join(t, ".nikos/upstream/acme/company-plan/planning/plan.yaml"), "name: Acme\nkey: CO\nperiod: Q1 2027\nlevel: company\npillars: []\n");
    expect(() => joinPlan(t, { repo: "acme/payments-group", url: grp })).toThrow();
    expect(existsSync(join(t, ".nikos/upstream/acme/payments-group"))).toBe(true);
  });
});
