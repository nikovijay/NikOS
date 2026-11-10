// The planning dashboard's pages, as HTML: the altitude switcher, the area picker, breadcrumbs with links,
// the views each level has, the four-column ladder, widening, the drill-downs, the row cap, and the query that
// holds the place. The page is read from the same fixture as plan-serve.test.ts. No page loads anything from
// another host, and its one script line parses.
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startPlanServe, type PlanServe } from "../src/plan/serve";
import { newBet } from "../src/planning/bets";
import { findArea } from "../src/plan/repo";
import { acmePlan } from "./plan-serve-fixture";

let open: PlanServe[] = [];
afterEach(async () => {
  await Promise.all(open.map((p) => p.srv.close()));
  open = [];
});

async function start(repo: string): Promise<PlanServe> {
  const plan = await startPlanServe(repo, { port: 0, offline: true });
  open.push(plan);
  return plan;
}

function get(port: number, path: string): Promise<{ status: number; text: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", fail);
    req.end();
  });
}

const FINANCE = "at=departments%2Ffinance";

describe("the altitude switcher and the area picker", () => {
  it("shows the four altitudes, marks the chosen one, and links each to an area at that level", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, "/?at=departments/finance")).text;
    expect(r).toContain('<a href="?at=company">Company</a>');
    expect(r).toContain('<a href="?at=departments%2Ffinance" class="on" aria-current="page">Departments</a>');
    expect(r).toContain('<a href="?at=groups%2Fpayments">Groups</a>');
    expect(r).toContain('<a href="?at=teams%2FWEB">Teams</a>');
  });

  it("lists only the areas at the chosen altitude in the picker, with no form around it", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, "/?at=groups/payments")).text;
    expect(r).toContain('<select onchange="location.href=this.value">');
    expect(r).toContain('<option value="?at=groups%2Fpayments" selected>Payments</option>');
    expect(r).not.toContain("Finance</option>");
    expect(r).not.toContain("<form");
    expect(r).not.toContain("<script src");
  });

  it("names the altitude a page is at, and says a level with no areas yet", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, "/")).text;
    expect(r).toContain('<a href="?at=company" class="on" aria-current="page">Company</a>');
  });
});

describe("breadcrumbs and the place in the URL", () => {
  it("shows the path from the company to a team, each part a link to its area", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, "/?at=teams/WEB")).text;
    expect(r).toContain(
      '<nav class="crumbs" aria-label="Breadcrumb"><a href="?at=company">Company</a> › <a href="?at=departments%2Ffinance">Finance</a> › <a href="?at=groups%2Fpayments">Payments</a> › <a href="?at=teams%2FWEB">WEB</a></nav>',
    );
  });

  it("keeps ?at= in every link the page makes to another view", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, "/?at=departments/finance")).text;
    const views = [...r.matchAll(/<nav class="views"[^>]*>(.*?)<\/nav>/gs)][0][1];
    const hrefs = [...views.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBe(5);
    for (const h of hrefs) expect(h).toContain(FINANCE);
  });
});

describe("the views each level has", () => {
  it("shows key results for a department and not for a group or team", async () => {
    const { srv } = await start(acmePlan());
    const dept = (await get(srv.port, `/?${FINANCE}&view=keys`)).text;
    expect(dept).toContain("<table>");
    expect(dept).toContain("Key result</th>");
    expect(dept).toContain(`href="?${FINANCE}&amp;kr=close-days"`);
    const group = (await get(srv.port, "/?at=groups/payments")).text;
    expect(group).not.toContain("Key result</th>");
    expect(group).not.toContain("view=keys");
    const asked = (await get(srv.port, "/?at=groups/payments&view=keys")).text;
    expect(asked).toContain("Key results its bets aim at");
  });

  it("opens on the OKRs and bets page by default, with each key result's bets under it", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, `/?${FINANCE}`)).text;
    expect(r).toContain('<a href="?at=departments%2Ffinance" class="on"');
    expect(r).toContain("Key results and the bets that aim at them");
    expect(r).toContain("Close days");
    expect(r).toContain("last 9 on 2026-11-09");
    expect(r).toContain("inbox-match");
  });

  it("shows the timeline's dated items in date order", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, `/?${FINANCE}&view=timeline`)).text;
    expect(r.indexOf("2027-02-14")).toBeLessThan(r.indexOf("2027-03-31"));
    expect(r).toContain("Key result due");
    expect(r).toContain("Review");
  });

  it("shows a team's bets with what they aim at and align to", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, "/?at=teams/WEB&view=bets")).text;
    expect(r).toContain("Aims at");
    expect(r).toContain('href="?at=teams%2FWEB&amp;kr=revenue"');
    expect(r).toContain('href="?at=groups%2Fpayments&amp;bet=faster-checkout"');
  });
});

describe("the ladder", () => {
  it("has the four columns, the cells' classes, and titles that can be cut with an ellipsis", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, `/?${FINANCE}&view=ladder`)).text;
    for (const head of ["Above key results", "This area&#39;s key results · 2027-Q1", "This area&#39;s bets", "Above bets"]) expect(r).toContain(head);
    expect(r).toContain('class="cell kr"');
    expect(r).toContain('class="cell bet"');
    expect(r).toContain("text-overflow:ellipsis");
    expect(r).toContain('<a class="t" href="?at=departments%2Ffinance&amp;kr=close-days">Close days</a>');
    expect(r).toContain("50% this period");
  });

  it("draws a curved line from each key result to the bets that aim at it, and from each bet to the one it aligns to", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, `/?${FINANCE}&view=ladder`)).text;
    const lines = [...r.matchAll(/<path d="M[^"]*C[^"]*"\/>/g)];
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("shows only one level above by default, and every level above when widened up", async () => {
    const { srv } = await start(acmePlan());
    const one = (await get(srv.port, "/?at=teams/WEB&view=ladder")).text;
    expect(one).toContain('class="cell above-bet"');
    expect(one).toContain('href="?at=groups%2Fpayments&amp;bet=faster-checkout">faster-checkout');
    expect(one).not.toContain('bet=inbox-match">inbox-match</a></div>');
    const up = (await get(srv.port, "/?at=teams/WEB&view=ladder&widen=up")).text;
    expect(up).toContain('bet=inbox-match">inbox-match</a>');
    expect(up).toContain('bet=one-inbox">one-inbox</a>');
    expect(up).toContain("Hide the levels above");
  });

  it("lists the bets below when widened down, each with how it delivers", async () => {
    const { srv } = await start(acmePlan());
    const plain = (await get(srv.port, "/?at=company&view=ladder")).text;
    expect(plain).not.toContain("Below this area");
    expect(plain).toContain("Show everything below");
    const down = (await get(srv.port, "/?at=company&view=ladder&widen=down")).text;
    expect(down).toContain("<h2>Below this area</h2>");
    expect(down).toContain('href="?at=groups%2Fpayments&amp;bet=faster-checkout">faster-checkout</a> (groups/payments)');
    expect(down).toContain("Below one-inbox");
    expect(down).toContain("Hide the levels below");
  });

  it("caps each column at twelve rows, with a count and a link to show them all", async () => {
    const repo = acmePlan();
    const finance = findArea(repo, "finance").dir;
    for (let i = 1; i <= 13; i++) newBet({ id: `extra-${i}`, owner: "Sam", hypothesis: "Another one.", reviewOn: "2027-02-14", primary: "close-days" }, finance);
    const { srv } = await start(repo);
    const capped = (await get(srv.port, `/?${FINANCE}&view=ladder`)).text;
    expect(capped).toContain("+2 more");
    expect(capped).toContain("more=all");
    const all = (await get(srv.port, `/?${FINANCE}&view=ladder&more=all`)).text;
    expect(all).not.toContain("more ·");
    expect(all).toContain('bet=extra-13">');
  });
});

describe("the drill-downs", () => {
  it("opens a key result on the bets and maps that deliver it, grouped by the area that holds them", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, `/?${FINANCE}&kr=close-days`)).text;
    expect(r).toContain("<h2>Key result: Close days</h2>");
    expect(r).toContain("Finance <span class=\"id\">departments/finance</span>");
    expect(r).toContain("Payments <span class=\"id\">groups/payments</span>");
    expect(r).toContain("Checkout web <span class=\"id\">teams/WEB</span>");
    expect(r).toContain("Also aims at it");
    expect(r).toContain("no story map names this bet yet");
    expect(r).toContain("Back to Finance");
  });

  it("opens a bet on the chain above it, the bets below it, and its maps", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, "/?at=groups/payments&bet=faster-checkout")).text;
    expect(r).toContain("<h2>Bet: faster-checkout</h2>");
    expect(r).toContain("<h2>Up the chain</h2>");
    expect(r).toContain('href="?at=departments%2Ffinance&amp;bet=inbox-match">inbox-match</a>');
    expect(r).toContain("Level 2 up");
    expect(r).toContain('href="?at=company&amp;bet=one-inbox">one-inbox</a>');
    expect(r).toContain("<h3>Below it</h3>");
    expect(r).toContain('bet=web-bet">web-bet</a>');
  });

  it("names a key result or bet that isn't there, and shows the page without it", async () => {
    const { srv } = await start(acmePlan());
    const kr = (await get(srv.port, `/?${FINANCE}&kr=nope`)).text;
    expect(kr).toContain("There&#39;s no key result called &#39;nope&#39;.");
    expect(kr).toContain("Key results and the bets that aim at them");
    const bet = (await get(srv.port, `/?${FINANCE}&bet=nope`)).text;
    expect(bet).toContain("There&#39;s no bet called &#39;nope&#39;.");
  });
});

describe("what the page is made of", () => {
  it("has no form, no script from another place, and one inline line of script that parses", async () => {
    const { srv } = await start(acmePlan());
    const r = (await get(srv.port, `/?${FINANCE}&view=ladder&widen=all`)).text;
    expect(r).not.toContain("<form");
    expect(r).not.toMatch(/<script\s+src=/);
    expect(r).not.toMatch(/https?:\/\//);
    expect(r).not.toContain("fetch(");
    const onchange = /onchange="([^"]*)"/.exec(r)![1].replace(/&amp;/g, "&");
    expect(() => new Function(onchange)).not.toThrow();
  });

  it("gives the same page's data as JSON, with the view and the drill", async () => {
    const { srv } = await start(acmePlan());
    const data = JSON.parse((await get(srv.port, `/api/data?${FINANCE}&kr=close-days`)).text);
    expect(data.view).toEqual({ view: "okrs", widen: { up: false, down: false }, more: false });
    expect(data.drill.kind).toBe("kr");
    expect(data.drill.kr.areas.map((a: { rel: string }) => a.rel)).toEqual(["departments/finance", "groups/payments", "teams/WEB"]);
    expect(data.belowBets).toEqual([]);
    const down = JSON.parse((await get(srv.port, "/api/data?at=company&widen=all")).text);
    expect(down.widen).toEqual({ up: true, down: true });
    expect(down.drill).toBeNull();
  });
});
