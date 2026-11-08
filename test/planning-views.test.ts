// The pages as data: OKRs and bets, the OKR ladder, and the group's bets and story maps. Each reads
// planningData's output only, so these tests build a repo, read its data, and check the view.
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { newBet } from "../src/planning/bets";
import { newKr } from "../src/planning/krs";
import { planningData } from "../src/planning/server";
import { betsAndStoryMaps, NOTE, okrLadder, okrsAndBets } from "../src/planning/views";
import { renderDashboard } from "../src/planning/ui";
import { assign } from "../src/commands/assign";
import { commitAll, companyRepo, departmentRepo, groupRepo } from "./planning-fixture";

describe("OKRs and bets", () => {
  it("a company with nothing above it says so", () => {
    const co = companyRepo();
    newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01", primary: "kr-1" }, co);
    const v = okrsAndBets(planningData(co));
    expect(v.noneAbove).toBe("Nothing above this plan is aligned to yet.");
    expect(v.above).toEqual([]);
    expect(v.byObjective).toEqual([{ objective: NOTE.noObjective, krs: [{ id: "kr-1", title: "Grow revenue", aligned: [], progress: 0 }] }]);
    expect(v.bets).toEqual([expect.objectContaining({ id: "faster", tag: "own", krs: ["kr-1"] })]);
    const page = renderDashboard({ data: planningData(co), readOnly: true });
    // The page draws the tree in the browser: the company has no columns above it.
    expect(page).toContain("Links, not totals. Each figure comes from its own plan.");
    expect(v).toMatchObject({ name: "Acme", aboveName: "" });
    expect(v.bets[0]).toMatchObject({ title: "Faster" });
  });

  it("a department shows the key result it aligns to above, with its repo", () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    newKr({ id: "pay-1", title: "Checkout conversion", owner: "Payments", baseline: 50, target: 60, by: "2027-03-31", alignsTo: "acme/company-plan#kr-1" }, dept);
    newBet({ id: "one-tap", owner: "Payments", hypothesis: "One tap lifts conversion", reviewOn: "2027-02-14", primary: "pay-1" }, dept);
    const v = okrsAndBets(planningData(dept));
    expect(v.above).toEqual([expect.objectContaining({ ref: "acme/company-plan#kr-1", repo: "acme/company-plan", title: "Grow revenue", found: true, from: ["pay-1"] })]);
    expect(v.noneAbove).toBe("");
    expect(v.bets[0]).toMatchObject({ id: "one-tap", tag: "own" });
    // The tree's labels: the plan above by name, with the share of the way to target from its copy.
    expect(v).toMatchObject({ name: "Payments", aboveName: "Acme" });
    expect(v.above[0]).toMatchObject({ plan: "Acme", progress: 0 });
    expect(v.byObjective[0].krs[0]).toMatchObject({ id: "pay-1", progress: 0 });
  });

  it("the OKR ladder marks the chain from this plan's key result up to the company", () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    newKr({ id: "pay-1", title: "Checkout conversion", owner: "Payments", baseline: 50, target: 60, by: "2027-03-31", alignsTo: "acme/company-plan#kr-1" }, dept);
    const ladder = okrLadder(planningData(dept));
    expect(ladder.above).toEqual([expect.objectContaining({ ref: "acme/company-plan#kr-1", onChain: true, note: NOTE.onChain })]);
    expect(ladder.own).toEqual([expect.objectContaining({ id: "pay-1", onChain: true, aligned: ["acme/company-plan#kr-1"] })]);
    const page = renderDashboard({ data: planningData(dept), readOnly: true });
    expect(page).toContain("On this plan's chain");
    expect(page).toContain("Highlighted: the path from this plan's key results up to the company.");
  });

  it("the ladder's upper column lists every key result above, and marks the ones on this plan's chain", () => {
    const data = {
      plan: { level: "department" },
      krs: [{ id: "pay-1", title: "Pay", objective: "", aligned: [{ ref: "acme/company-plan#kr-1", found: true, kr: { title: "Grow" } }] }],
      upstream: [{ repo: "acme/company-plan", krs: [{ id: "kr-1", title: "Grow" }, { id: "kr-2", title: "Cut churn" }] }],
    };
    const ladder = okrLadder(data);
    expect(ladder.above.map((a: any) => a.ref)).toEqual(["acme/company-plan#kr-1", "acme/company-plan#kr-2"]);
    expect(ladder.above.map((a: any) => a.onChain)).toEqual([true, false]);
  });

  it("the ladder's empty column says what to run", () => {
    const co = companyRepo();
    // A company plan is the top: nothing sits above it, so the sync hint doesn't apply.
    expect(okrLadder(planningData(co)).emptyAbove).toBe("This is the top plan: nothing sits above it.");
    const dept = departmentRepo();
    expect(okrLadder(planningData(dept)).emptyAbove).toBe("No company key results loaded. Run nikos planning sync to refresh the copies.");
  });
});

describe("bets and story maps", () => {
  it("a group with several story maps lists every map", () => {
    const g = groupRepo("PAY");
    mkdirSync(join(g, "maps/pay"), { recursive: true });
    writeFileSync(join(g, "maps/pay/storymap.yaml"), "format_version: 1\nproject: pay\nkey: PAY\nbet: faster-checkout\nactivities: []\nreleases: []\n");
    commitAll(g, "second map");
    const data = planningData(g);
    expect(data.story.releases).toEqual([]);
    expect(data.maps.map((m) => m.id)).toEqual(["chk", "pay"]);
    const v = betsAndStoryMaps(data);
    expect(v.maps.map((m) => m.key)).toEqual(["CHK", "PAY"]);
    expect(v.maps[0].stories.map((s) => s.id)).toEqual(["PAY-CHK-1", "PAY-CHK-2", "PAY-CHK-3"]);
  });

  it("with no team read yet, a team's stories say not fetched, and the footnote says nothing is fetched", () => {
    const g = groupRepo("PAY");
    assign(g, "Checkout web", { repo: "acme/checkout-web", stories: ["PAY-CHK-1"] });
    commitAll(g, "assign");
    const data = planningData(g);
    expect(data.teamIndex.fetched).toBeNull();
    const row = data.maps[0].stories.find((s) => s.id === "PAY-CHK-1")!;
    expect(row).toMatchObject({ team: "Checkout web", repo: "acme/checkout-web" });
    expect(row.freshness).toBe("not-fetched");
    expect(row.reason).toContain("hasn't been fetched");
    expect(betsAndStoryMaps(data).foot).toBe(NOTE.groupNotFetched);
  });

  it("a group's page has no key results of its own, and links to the story maps", () => {
    const page = renderDashboard({ data: planningData(groupRepo("PAY")), readOnly: true });
    expect(page).toContain('data-nav="groupmaps" href="#/groupmaps">Bets and story maps');
    expect(page).not.toContain('data-nav="krs" href="#/krs">Key results');
    expect(page).not.toContain("Rollout");
  });
});

describe("the snapshot page", () => {
  it("has no outside links, no fetch and no token", () => {
    const html = renderDashboard({ data: planningData(companyRepo()), readOnly: true });
    expect(html).not.toContain("fetch(");
    expect(html).not.toContain("X-Nikos-Token");
    expect(html).not.toMatch(/(src|href)=["']https?:\/\//i);
  });
});

describe("the live page's script", () => {
  it("compiles, so a syntax slip in the page shows here and not in a browser", () => {
    const html = renderDashboard({ data: planningData(companyRepo()), token: "t0k3n", readOnly: false });
    const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1] ?? "";
    expect(script).toContain("function apiOp");
    expect(() => new Function(script)).not.toThrow();
    const exported = renderDashboard({ data: planningData(companyRepo()), readOnly: true });
    const exportScript = exported.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1] ?? "";
    expect(() => new Function(exportScript)).not.toThrow();
  });
});
