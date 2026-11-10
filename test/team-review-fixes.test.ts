// Review fixes: canonical bet names match across repos, a map's bet is checked for form only, migrate
// maps --help prints its usage, and planning status spaces a word unit
// from its number.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storiesFor, canonicalBet } from "../src/lib/bets";
import { validate } from "../src/commands/validate";
import { newKr } from "../src/planning/krs";
import { planStatus } from "../src/plan/cli";
import { initPlanRepo } from "../src/plan/repo";
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

describe("validate checks a map's bet for form only", () => {
  it("accepts a bet id whose card isn't in the repo", () => {
    // The map names a bet by its id; no card is looked up, since a code repo can't read a planning repo.
    const t = groupRepo("PAY");
    const story = join(t, "maps/chk/storymap.yaml");
    write(story, readFileSync(story, "utf8").replace("bet: faster-checkout", "bet: fastr-checkout"));
    const errors = validate(t).errors.map((e) => e.message);
    expect(errors.some((m) => m.includes("fastr-checkout"))).toBe(false);
  });
});

describe("planning status spaces a word unit from its number", () => {
  it("prints days after a space, and % tight to the number", () => {
    const co = mkdtempSync(join(tmpdir(), "nikos-units-"));
    git(co, "init", "-q", "-b", "main");
    initPlanRepo(co, { name: "Acme", year: "2027" });
    const area = join(co, "planning", "company");
    newKr({ id: "close-days", title: "Close the books", owner: "Finance", baseline: 12, target: 7, by: "2027-03-31", unit: "days" }, area);
    newKr({ id: "retention", title: "Retention", owner: "Product", baseline: 50, target: 60, by: "2027-03-31", unit: "%" }, area);
    const text = planStatus(co);
    expect(text).toContain("(baseline 12 days, target 7 days by 2027-03-31)");
    expect(text).toContain("(baseline 50%, target 60% by 2027-03-31)");
  });
});
