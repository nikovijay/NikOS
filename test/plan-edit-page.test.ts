// The dashboard's forms, as the page carries them: the live page has the forms to add and edit key results and
// bets, with the choices drawn from the company and the versions a save sends back; the offline export has none
// of them. Also the names a page shows instead of area rels, the empty states, and the script's id rule, which is
// the rules module's own function, so the id box makes the id the command makes.
import { request } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportPlanPage, startPlanServe, type PlanServe } from "../src/plan/serve";
import { addArea, findArea, initPlanRepo } from "../src/plan/repo";
import { newBet } from "../src/planning/bets";
import { newKr } from "../src/planning/krs";
import { hash } from "../src/planning/model";
import { idFromTitle } from "../src/planning/rules";
import { acmePlan } from "./plan-serve-fixture";

let open: PlanServe[] = [];
let made: string[] = [];
afterEach(async () => {
  await Promise.all(open.map((p) => p.srv.close()));
  open = [];
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh temporary folder, removed after the test. */
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

async function start(repo: string): Promise<PlanServe> {
  const plan = await startPlanServe(repo, { port: 0, offline: true });
  open.push(plan);
  return plan;
}

function get(port: number, path: string): Promise<string> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => ok(text));
    });
    req.on("error", fail);
    req.end();
  });
}

/** Every form that saves through an op, with its opening tag's attributes read back and its markup. */
function saveForms(html: string): { op: string; area: string; target: Record<string, string>; expect: string | null; body: string }[] {
  const out: { op: string; area: string; target: Record<string, string>; expect: string | null; body: string }[] = [];
  for (const m of html.matchAll(/<form class="save[^"]*"([^>]*)>([\s\S]*?)<\/form>/g)) {
    const tag = m[1];
    const attr = (name: string) => {
      const v = new RegExp(` ${name}="([^"]*)"`).exec(tag);
      return v ? v[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&") : null;
    };
    out.push({
      op: attr("data-op") ?? "",
      area: attr("data-area") ?? "",
      target: JSON.parse(attr("data-target") ?? "{}"),
      expect: attr("data-expect"),
      body: m[2],
    });
  }
  return out;
}

/** The page's text with its markup, scripts and styles taken out: what a person reads. */
const readable = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");

/** The live script: the last script on the page, which holds the save and the forms' rules. */
const scriptOf = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()![1];

const FINANCE = "at=departments%2Ffinance";

describe("the forms on the live page", () => {
  it("a department's key result form offers its quarter, and the company's key results to align to, by name", async () => {
    const { srv } = await start(acmePlan());
    const html = await get(srv.port, `/?${FINANCE}&view=keys`);
    expect(html).toContain('<details class="card add" id="add-kr"><summary>Add a key result</summary>');
    const form = saveForms(html).find((f) => f.op === "kr.new")!;
    expect(form.area).toBe("departments/finance");
    expect(form.expect).toBeNull();
    expect(form.body).toContain('<select name="period"');
    expect(form.body).toContain('<option value="2027-Q1" selected>2027-Q1</option>');
    expect(form.body).toContain('<select name="aligns_to" multiple');
    expect(form.body).toContain('<option value="revenue">Revenue · Acme</option>');
  });

  it("the company's key result form has no quarter: its key results are for the year", async () => {
    const { srv } = await start(acmePlan());
    const html = await get(srv.port, "/?at=company&view=okrs");
    const form = saveForms(html).find((f) => f.op === "kr.new")!;
    expect(form.area).toBe("company");
    expect(form.body).not.toContain('name="period"');
    expect(form.body).not.toContain('name="aligns_to"');
    expect(form.body).toContain('<select name="kind"');
  });

  it("the new key result form has a kind that shows its own fields, and an id that follows the title until typed in", async () => {
    const { srv } = await start(acmePlan());
    const form = saveForms(await get(srv.port, `/?${FINANCE}&view=okrs`)).find((f) => f.op === "kr.new")!;
    expect(form.body).toContain('data-when="kind=number"');
    expect(form.body).toContain('data-when="kind=milestone"');
    expect(form.body).toContain('<textarea name="steps" data-list="lines"');
    expect(form.body).toContain('<input name="kr" data-to="target" data-id-from="title"');
  });

  it("the bet form offers the company's key results to aim at, with a blank 'Not yet', and the bets above to align to", async () => {
    const { srv } = await start(acmePlan());
    const form = saveForms(await get(srv.port, "/?at=teams%2FWEB&view=bets")).find((f) => f.op === "bet.new")!;
    expect(form.area).toBe("teams/WEB");
    expect(form.body).toContain('<option value="">Not yet</option>');
    expect(form.body).toContain('<option value="close-days">Close days · Finance</option>');
    expect(form.body).toContain('<option value="revenue">Revenue · Acme</option>');
    expect(form.body).toContain('<option value="faster-checkout">faster-checkout · Payments</option>');
    expect(form.body).toContain('<textarea name="hypothesis" required');
    expect(form.body).toContain('<input name="review_on" required type="date"');
  });

  it("the company's bet form has no bets to align to, so that field is not offered", async () => {
    const { srv } = await start(acmePlan());
    const form = saveForms(await get(srv.port, "/?at=company&view=bets")).find((f) => f.op === "bet.new")!;
    expect(form.body).toContain('<select name="primary"');
    expect(form.body).not.toContain('name="aligns_to"');
  });

  it("an edit of a key result carries the version the page read, and its details are filled in", async () => {
    const repo = acmePlan();
    const { srv } = await start(repo);
    const version = hash(readFileSync(join(repo, "planning/departments/finance/krs/close-days.yaml"), "utf8"));
    const forms = saveForms(await get(srv.port, `/?${FINANCE}&view=okrs`));
    const edit = forms.find((f) => f.op === "kr.edit")!;
    expect(edit.target).toEqual({ kr: "close-days" });
    expect(edit.area).toBe("departments/finance");
    expect(edit.expect).toBe(version);
    expect(edit.body).toMatch(/<input name="title" required type="text" value="Close days"/);
    expect(edit.body).toMatch(/<input name="by" required type="date" value="2027-03-31"/);
    expect(edit.body).toContain('<option value="down" selected>Down</option>');
    const target = forms.find((f) => f.op === "kr.target")!;
    expect(target.expect).toBe(version);
    expect(target.body).toContain('value="7"');
    expect(target.body).toContain("The original target stays on record.");
    const align = forms.find((f) => f.op === "kr.align")!;
    expect(align.expect).toBe(version);
    expect(align.body).toContain('<option value="revenue">Revenue · Acme</option>');
  });

  it("an edit of a bet carries the version the page read, on each of its forms", async () => {
    const repo = acmePlan();
    const { srv } = await start(repo);
    const version = hash(readFileSync(join(repo, "planning/teams/WEB/bets/web-bet.md"), "utf8"));
    const forms = saveForms(await get(srv.port, "/?at=teams%2FWEB&view=bets")).filter((f) => f.target.bet === "web-bet");
    expect(forms.map((f) => f.op)).toEqual(["bet.edit", "bet.krs", "bet.align", "bet.review"]);
    for (const f of forms) {
      expect(f.expect).toBe(version);
      expect(f.area).toBe("teams/WEB");
    }
    const review = forms.find((f) => f.op === "bet.review")!;
    expect(review.body).toContain('<option value="complete">Complete</option>');
    expect(review.body).toContain('<textarea name="reason" required');
  });

  it("a bet's Aligns to shows what it is already aligned to, even when that is not offered", async () => {
    const repo = acmePlan();
    const { srv } = await start(repo);
    const web = saveForms(await get(srv.port, "/?at=teams%2FWEB&view=bets")).find((f) => f.op === "bet.align" && f.target.bet === "web-bet")!;
    expect(web.body).toContain('<option value="faster-checkout" selected>');
  });

  it("the form's fields are all labelled: each named control sits inside a labelled field", async () => {
    const { srv } = await start(acmePlan());
    for (const form of saveForms(await get(srv.port, "/?at=teams%2FWEB&view=bets"))) {
      const controls = (form.body.match(/<(input|select|textarea) name="/g) ?? []).length;
      const labelled = (form.body.match(/<label class="field/g) ?? []).length;
      expect(labelled).toBeGreaterThanOrEqual(controls);
    }
  });

  it("the live script parses, posts only to /api/op, and carries the rules the forms need", async () => {
    const { srv } = await start(acmePlan());
    const script = scriptOf(await get(srv.port, `/?${FINANCE}&view=okrs`));
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('"/api/op"');
    expect(script).not.toMatch(/https?:\/\//);
    expect(script).toContain("This changed since the page loaded. Reload to see the latest, then try again.");
    expect(script).toContain("closest(\"[hidden]\")");
    expect(script).toContain("data-open");
  });

  it("the id box in the script makes the same id as the rules module, for any title", async () => {
    const { srv } = await start(acmePlan());
    const script = scriptOf(await get(srv.port, `/?${FINANCE}&view=okrs`));
    const source = /function idFromTitle\(title\) \{[\s\S]*?\n\}/.exec(script)?.[0];
    expect(source).toBeDefined();
    const inPage = new Function(`${source}; return idFromTitle;`)() as (t: string) => string | undefined;
    const titles = ["Close days", "  Ship it!!  ", "Ümlaut and naïve", "!!!", "", "a".repeat(45), "Faster checkout for every returning customer in the EU", "Plan 2027-Q1: close", "x-y--z"];
    for (const t of titles) expect(inPage(t)).toBe(idFromTitle(t));
    // Cut at 40 characters, then back to the last hyphen before them.
    expect(inPage("Faster checkout for every returning customer in the EU")).toBe("faster-checkout-for-every-returning");
  });

  it("the page offers its objectives as suggestions, once, from the area's key results", async () => {
    const repo = acmePlan();
    newKr({ id: "close-faster", title: "Close faster", owner: "Mira", baseline: 11, target: 7, by: "2027-03-31", period: "2027-Q1", objective: "Close the books faster" }, findArea(repo, "finance").dir);
    const { srv } = await start(repo);
    const html = await get(srv.port, `/?${FINANCE}&view=okrs`);
    expect(html.match(/<datalist id="objectives">/g)).toHaveLength(1);
    expect(html).toContain('<option value="Close the books faster">');
    expect(saveForms(html).find((f) => f.op === "kr.edit")!.body).toContain('list="objectives"');
  });
});

describe("names, not ids of areas", () => {
  it("shows bet titles in place of ids, with the id after, and area names where the rel was", async () => {
    const repo = acmePlan();
    newBet({ id: "speed-up", title: "Speed up checkout", owner: "Ana", hypothesis: "Quicker pages sell more.", reviewOn: "2027-02-14", primary: "close-days" }, findArea(repo, "payments").dir);
    const { srv } = await start(repo);
    const bets = await get(srv.port, "/?at=groups%2Fpayments&view=bets");
    expect(bets).toContain('>Speed up checkout</a> <span class="id">speed-up</span>');
    expect(bets).toContain('<span class="where">Payments</span>');
    const okrs = await get(srv.port, `/?${FINANCE}&view=okrs`);
    expect(okrs).toContain('>Speed up checkout</a> <span class="id">speed-up</span>');
  });

  it("the timeline names a key result by its title, not by its id", async () => {
    const { srv } = await start(acmePlan());
    const html = await get(srv.port, `/?${FINANCE}&view=timeline`);
    expect(html).toMatch(/<a href="[^"]*kr=close-days[^"]*">Close days<\/a>/);
    expect(html).not.toContain("close-days — Close days");
  });

  it("a team's page shows no quarter row and no notice about key results, since teams have none", async () => {
    const { srv } = await start(acmePlan());
    const html = await get(srv.port, "/?at=teams%2FWEB&view=bets&period=2030-Q1");
    expect(html).not.toContain("There are no key results");
    expect(html).not.toContain('class="quarters"');
  });

  it("a bet without a title keeps its id as its name, with no second id after it", async () => {
    const { srv } = await start(acmePlan());
    const html = await get(srv.port, "/?at=teams%2FWEB&view=bets");
    expect(html).toContain('>web-bet</a> <span class="where">Checkout web</span>');
  });

  it("no page reads an area's rel in its text: the names are shown, the rels only in links and forms", async () => {
    const repo = acmePlan();
    newBet({ id: "speed-up", title: "Speed up checkout", owner: "Ana", hypothesis: "Quicker pages sell more.", reviewOn: "2027-02-14", primary: "close-days" }, findArea(repo, "payments").dir);
    const { srv } = await start(repo);
    const pages = [
      "/?at=company&view=okrs",
      "/?at=company&view=ladder&widen=all",
      `/?${FINANCE}&view=keys`,
      `/?${FINANCE}&view=timeline`,
      "/?at=groups%2Fpayments&view=bets",
      "/?at=teams%2FWEB&view=bets",
      `/?${FINANCE}&kr=close-days`,
      "/?at=groups%2Fpayments&bet=faster-checkout",
    ];
    for (const path of pages) {
      const text = readable(await get(srv.port, path));
      expect(text, path).not.toMatch(/departments\/|groups\/|teams\//);
    }
  });

  it("the altitude links and the area picker show names too", async () => {
    const { srv } = await start(acmePlan());
    const html = await get(srv.port, "/?at=teams%2FWEB");
    expect(html).toContain('<option value="?at=teams%2FWEB&amp;period=2027-Q1" selected>Checkout web (WEB)</option>');
  });
});

describe("the empty states", () => {
  it("the company's key results say the year, and offer to add one", async () => {
    const dir = tmp("nikos-empty-");
    initPlanRepo(dir, { name: "Acme", year: "2027" });
    const { srv } = await start(dir);
    const html = await get(srv.port, "/?at=company&view=keys");
    expect(html).toContain("No key results for 2027 yet.");
    expect(html).not.toContain("this quarter");
    expect(html).toContain('<button type="button" class="primary" data-open="add-kr">Add a key result</button>');
    expect(html).toContain('<details class="card add" id="add-kr">');
  });

  it("a department with no key results yet says its year's first quarter, and the form preselects that quarter", async () => {
    // A year far from today, so the quarter today is never inside it: the form must not offer today's quarter.
    const dir = tmp("nikos-empty-");
    initPlanRepo(dir, { name: "Acme", year: "2090" });
    addArea(dir, "department", "finance", { name: "Finance", owner: "Mira" });
    const { srv } = await start(dir);
    const html = await get(srv.port, `/?${FINANCE}&view=okrs`);
    expect(html).toContain("No key results for 2090-Q1 yet.");
    expect(html).toContain('data-open="add-kr"');
    const form = saveForms(html).find((f) => f.op === "kr.new" && f.area === "departments/finance")!;
    expect(form.body).toContain('<option value="2090-Q1" selected>2090-Q1</option>');
    expect(form.body).not.toMatch(/<option value="2026-Q4"/);
  });

  it("a department's OKRs view has the add-a-bet form at the top, once, with key results or without", async () => {
    const { srv } = await start(acmePlan());
    const withKrs = await get(srv.port, `/?${FINANCE}&view=okrs`);
    expect(withKrs.match(/id="add-bet"/g)).toHaveLength(1);
    expect(withKrs.indexOf('id="add-bet"')).toBeLessThan(withKrs.indexOf("Key results and the bets that aim at them"));
    const repo = acmePlan();
    addArea(repo, "team", "NEW", { name: "New team", home: "payments" });
    const team = await get((await start(repo)).srv.port, "/?at=teams%2FNEW&view=okrs");
    expect(team.match(/id="add-bet"/g)).toHaveLength(1);
  });

  it("the key result form's Starts at and Target are required only while the kind shows them", async () => {
    const { srv } = await start(acmePlan());
    const form = saveForms(await get(srv.port, `/?${FINANCE}&view=okrs`)).find((f) => f.op === "kr.new")!;
    expect(form.body).toContain('<input name="baseline" data-required type="number"');
    expect(form.body).toContain('<input name="target" data-required type="number"');
    expect(form.body).not.toMatch(/<input name="(baseline|target)" required/);
    expect(scriptOf(await get(srv.port, `/?${FINANCE}&view=okrs`))).toContain('setAttribute("required", "")');
  });

  it("the id box is not sent until someone types in it, so the server makes the id and skips one that is taken", async () => {
    const { srv } = await start(acmePlan());
    const script = scriptOf(await get(srv.port, `/?${FINANCE}&view=okrs`));
    const source = /function sends\(f\) \{[\s\S]*?\n\}/.exec(script)?.[0];
    expect(source).toBeDefined();
    const sends = new Function(`${source}; return sends;`)() as (f: { hasAttribute(name: string): boolean }) => boolean;
    const el = (attrs: string[]) => ({ hasAttribute: (name: string) => attrs.includes(name) });
    expect(sends(el([]))).toBe(true);
    expect(sends(el(["data-id-from"]))).toBe(false);
    expect(sends(el(["data-id-from", "data-typed"]))).toBe(true);
    const form = saveForms(await get(srv.port, `/?${FINANCE}&view=okrs`)).find((f) => f.op === "kr.new")!;
    expect(form.body).toContain('<input name="kr" data-to="target" data-id-from="title"');
  });

  it("a group with no bets of its own, aiming at nothing, offers to add a bet in its own empty state", async () => {
    const repo = acmePlan();
    addArea(repo, "group", "billing", { name: "Billing", department: "finance" });
    const { srv } = await start(repo);
    const html = await get(srv.port, "/?at=groups%2Fbilling&view=okrs");
    expect(html).toContain("Its bets aim at no key results yet.");
    expect(html).toContain('data-open="add-bet"');
    expect(saveForms(html).some((f) => f.op === "bet.new" && f.area === "groups/billing")).toBe(true);
  });

  it("a team with no bets says which area they are in, and offers to add one", async () => {
    const repo = acmePlan();
    addArea(repo, "team", "NEW", { name: "New team", home: "payments" });
    const { srv } = await start(repo);
    const html = await get(srv.port, "/?at=teams%2FNEW&view=bets");
    expect(html).toContain("No bets in New team yet.");
    expect(html).toContain('<button type="button" class="primary" data-open="add-bet">Add a bet</button>');
  });
});

describe("the drill-downs", () => {
  it("a bet opens with its edit forms when it is in this area, and says where to change it otherwise", async () => {
    const { srv } = await start(acmePlan());
    const own = await get(srv.port, "/?at=groups%2Fpayments&bet=faster-checkout");
    expect(saveForms(own).some((f) => f.op === "bet.edit" && f.target.bet === "faster-checkout")).toBe(true);
    const elsewhere = await get(srv.port, "/?at=company&bet=faster-checkout");
    expect(saveForms(elsewhere).some((f) => f.op === "bet.edit")).toBe(false);
    expect(elsewhere).toContain('To change this bet, open it in <a href="?at=groups%2Fpayments&amp;bet=faster-checkout">Payments</a>.');
  });

  it("a key result opens with its edit forms in its own area, and says where to change it otherwise", async () => {
    const { srv } = await start(acmePlan());
    const own = await get(srv.port, `/?${FINANCE}&kr=close-days`);
    expect(saveForms(own).some((f) => f.op === "kr.edit" && f.target.kr === "close-days")).toBe(true);
    const elsewhere = await get(srv.port, "/?at=company&kr=close-days");
    expect(saveForms(elsewhere).some((f) => f.op === "kr.edit")).toBe(false);
    expect(elsewhere).toContain("To change this key result, open it in");
  });
});

describe("the offline export", () => {
  it("has no form, no save version, no suggestions and no button; its empty states say the command", async () => {
    const repo = acmePlan();
    addArea(repo, "team", "NEW", { name: "New team", home: "payments" });
    const out = join(tmp("nikos-export-"), "plan.html");
    await exportPlanPage(repo, out, { offline: true, at: "teams/NEW" });
    const html = readFileSync(out, "utf8");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("data-expect");
    expect(html).not.toContain("<datalist");
    // The theme switch is a button on every page; no form button is.
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('class="primary"');
    expect(html).not.toContain("data-open");
    expect(html).toContain("No bets in New team yet.");
    expect(html).toContain('Add one with <code>nikos plan bet new --title &quot;...&quot;</code>.');
  });

  it("names the areas and the bets, with the forms' styles still in the page", async () => {
    const repo = acmePlan();
    const out = join(tmp("nikos-export-"), "plan.html");
    await exportPlanPage(repo, out, { offline: true, at: "departments/finance" });
    const html = readFileSync(out, "utf8");
    expect(html).toContain("Checkout web");
    expect(html).toContain(".field{display:flex");
    expect(html).toContain('<a href="?at=groups%2Fpayments&amp;bet=faster-checkout');
  });
});

describe("the look of the forms", () => {
  it("the error colour has a value in light, and one in each dark block", async () => {
    const { srv } = await start(acmePlan());
    const html = await get(srv.port, `/?${FINANCE}&view=okrs`);
    expect(html).toContain("--error:#9b1c1c");
    expect(html.match(/--error:#ffb3b3/g)).toHaveLength(2);
    expect(html).toContain("grid-template-columns:minmax(0,1fr)");
    expect(html).toContain("[hidden]{display:none!important}");
  });

  it("the form controls take the page's colours, so they read in dark mode too", async () => {
    const { srv } = await start(acmePlan());
    const html = await get(srv.port, `/?${FINANCE}&view=okrs`);
    expect(html).toContain("select,textarea{background:var(--card);color:var(--fg)");
  });

  it("a bet's edit form shows its confidence, and a company bet has no Aligns to form", async () => {
    const { srv } = await start(acmePlan());
    const edit = saveForms(await get(srv.port, `/?${FINANCE}&view=bets`)).find((f) => f.op === "bet.edit" && f.target.bet === "inbox-match")!;
    expect(edit.body).toContain('<option value="medium" selected>Medium</option>');
    expect(edit.body).toContain('<option value="high">High</option>');
    const company = saveForms(await get(srv.port, "/?at=company&view=bets"));
    expect(company.some((f) => f.op === "bet.align")).toBe(false);
  });
});
