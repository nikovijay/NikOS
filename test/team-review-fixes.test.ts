// Review fixes: canonical bet names match across repos, validate checks a map's local bet even with no
// planning/bets folder, migrate maps --help prints its usage, and planning status spaces a word unit
// from its number.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storiesFor, canonicalBet } from "../src/lib/bets";
import { runMigrateMaps } from "../src/commands/migrate-maps";
import { companyInit } from "../src/commands/start";
import { validate } from "../src/commands/validate";
import { newKr } from "../src/planning/krs";
import { status } from "../src/planning/cli";
import { git, groupRepo, write } from "./repo-fixture";

afterEach(() => vi.restoreAllMocks());

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

describe("validate checks a map's local bet even with no planning/bets card", () => {
  it("reports a bet the repo doesn't have", () => {
    // The map names a bet the repo has; the bet is then renamed in the map, so no card has that id.
    const t = groupRepo("PAY");
    const story = join(t, "maps/chk/storymap.yaml");
    write(story, readFileSync(story, "utf8").replace("bet: faster-checkout", "bet: fastr-checkout"));
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
