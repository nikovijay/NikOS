// Review fixes on the team amendment: canonical bet names match across repos, validate checks an own
// map's local bet without a bets folder, migrate maps --help prints its usage, a planning status line
// spaces its unit, and a team's new map needs its home.
import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storiesFor, canonicalBet } from "../src/lib/bets";
import { parseTeam, openTeam } from "../src/lib/team";
import { teamInit, teamShow, runTeam } from "../src/commands/team";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { validate } from "../src/commands/validate";
import { joinPlan } from "../src/commands/join";
import { runMigrateMaps } from "../src/commands/migrate-maps";
import { companyInit } from "../src/commands/start";
import { newKr } from "../src/planning/krs";
import { status } from "../src/planning/cli";
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

describe("planning status spaces a word unit from its number", () => {
  it("prints days after a space, and % tight to the number", () => {
    const co = mkdtempSync(join(tmpdir(), "nikos-units-"));
    git(co, "init", "-q", "-b", "main");
    companyInit(co, { name: "Acme", period: "Q1 2027", repo: "acme/company-plan" });
    newKr({ id: "close-days", title: "Close the books", owner: "Finance", baseline: 12, target: 7, by: "2027-03-31", unit: "days" }, co);
    newKr({ id: "retention", title: "Retention", owner: "Product", baseline: 50, target: 60, by: "2027-03-31", unit: "%" }, co);
    const text = status(co);
    expect(text).toContain("(baseline 12 days, target 7 days by 2027-03-31)");
    expect(text).toContain("(baseline 50%, target 60% by 2027-03-31)");
  });
});

describe("map new in a team needs a home, and names the join by whether the team has one", () => {
  it("refuses a team with a key and no home, with the home it needs", () => {
    const t = mkdtempSync(join(tmpdir(), "nikos-nohome-"));
    git(t, "init", "-q", "-b", "main");
    teamInit(t, { repo: "acme/web-team", name: "Web team", key: "WEB" });
    write(join(t, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
    expect(() => newMap({ bet: "faster-checkout", key: "INB" }, t)).toThrow("a team that joins a plan or owns a map needs one home: nikos join <plan> --home");
  });
  it("names a plain join for a plan the team joins from a bet, once it has its home", () => {
    const t = teamWithMap();
    expect(() => newMap({ bet: "acme/company-plan#one-inbox", key: "OTH" }, t)).toThrow("acme/company-plan isn't a plan this team joins: nikos join acme/company-plan first");
  });
});
