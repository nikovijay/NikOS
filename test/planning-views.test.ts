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
import { commitAll, companyRepo, groupRepo } from "./planning-fixture";

describe("OKRs and bets", () => {
  it("a company with nothing above it says so", () => {
    const co = companyRepo();
    const area = join(co, "planning", "company");
    newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01", primary: "kr-1" }, area);
    const v = okrsAndBets(planningData(area));
    expect(v.noneAbove).toBe("Nothing above this plan is aligned to yet.");
    expect(v.above).toEqual([]);
    expect(v.byObjective).toEqual([{ objective: NOTE.noObjective, krs: [{ id: "kr-1", title: "Grow revenue", aligned: [], progress: 0 }] }]);
    expect(v.bets).toEqual([expect.objectContaining({ id: "faster", tag: "own", krs: ["kr-1"] })]);
    const page = renderDashboard({ data: planningData(area), readOnly: true });
    // The page draws the tree in the browser: the company has no columns above it.
    expect(page).toContain("Links, not totals. Each figure comes from its own plan.");
    expect(v).toMatchObject({ name: "Acme", aboveName: "" });
    expect(v.bets[0]).toMatchObject({ title: "Faster" });
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

  it("a story's status is the one its map's delivery.yaml says, and the footnote says nothing is fetched", () => {
    const data = planningData(groupRepo("PAY"));
    const row = data.maps[0].stories.find((s: any) => s.id === "PAY-CHK-1")!;
    expect(row).toMatchObject({ status: "todo", freshness: "summary" });
    expect(data).not.toHaveProperty("teamIndex");
    expect(betsAndStoryMaps(data).foot).toBe(NOTE.groupFoot);
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
