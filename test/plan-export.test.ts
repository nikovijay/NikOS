// nikos plan serve --export: one offline file. With --at it holds that area's pages; without, every area's.
// The file's own script moves between the pages it holds, so every link in it must have its page.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportPlanPage } from "../src/plan/serve";
import { addArea, initPlanRepo } from "../src/plan/repo";
import { groupRepo } from "./repo-fixture";
import { acmePlan } from "./plan-serve-fixture";

const target = () => join(mkdtempSync(join(tmpdir(), "nikos-export-")), "plan.html");

/** The pages the file holds, keyed by their query, from the one line the export writes them on. */
function pagesIn(html: string): Record<string, { title: string; body: string }> {
  const line = /var pages = (.*);\n/.exec(html);
  expect(line).not.toBeNull();
  return JSON.parse(line![1]!);
}

/** Every link and picker choice in a body that is a query on this dashboard. */
function queriesIn(body: string): string[] {
  return [...body.matchAll(/(?:href|value)="\?([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
}

describe("nikos plan serve --export", () => {
  it("holds only the area --at names, and links to other areas say they aren't in the file", async () => {
    const out = target();
    await exportPlanPage(acmePlan(), out, { offline: true, at: "departments/finance" });
    const html = readFileSync(out, "utf8");
    const pages = pagesIn(html);
    const keys = Object.keys(pages);
    expect(keys.length).toBeGreaterThan(1);
    expect(keys.every((k) => k.startsWith("at=departments%2Ffinance"))).toBe(true);
    expect(keys).toContain("at=departments%2Ffinance");
    expect(html).toContain("Close days");
    expect(html).toContain("That page isn't in this file. Export without --at to include every area.");
    expect(html).toContain("Finance");
  });

  it("holds every area's pages with no --at, and the file starts on the company", async () => {
    const out = target();
    await exportPlanPage(acmePlan(), out, { offline: true });
    const html = readFileSync(out, "utf8");
    const keys = Object.keys(pagesIn(html));
    for (const k of ["at=company", "at=departments%2Ffinance", "at=groups%2Fpayments", "at=teams%2FWEB"]) expect(keys).toContain(k);
    expect(html).toContain('var start = "at=company";');
    expect(html).toContain("view=ladder");
  });

  it("has every link's page in the file, so the switcher, picker and drill-downs never miss", async () => {
    const out = target();
    await exportPlanPage(acmePlan(), out, { offline: true });
    const pages = pagesIn(readFileSync(out, "utf8"));
    for (const page of Object.values(pages)) {
      for (const q of queriesIn(page.body)) expect(Object.keys(pages)).toContain(new URLSearchParams(q).toString());
    }
  });

  it("is one self-contained page: no form, no request, no outside script or style", async () => {
    const out = target();
    await exportPlanPage(acmePlan(), out, { offline: true, at: "company" });
    const html = readFileSync(out, "utf8");
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|<script src|<link /);
    expect(html).not.toContain("token=");
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it("keeps the place in both ?at= and #at=, and reads either when the file opens", async () => {
    const out = target();
    await exportPlanPage(acmePlan(), out, { offline: true });
    const html = readFileSync(out, "utf8");
    expect(html).toContain('history.replaceState(null, "", "?" + key + "#" + key);');
    expect(html).toContain("location.search");
    expect(html).toContain("location.hash");
    // The first script line parses as JavaScript, so a broken file fails here rather than in the browser.
    const script = /<script>\n([\s\S]*)\n<\/script>/.exec(html)![1]!;
    expect(() => new Function(script)).not.toThrow();
  });

  it("escapes markup in names, so no page can end the script early", async () => {
    const repo = acmePlan();
    addArea(repo, "department", "evil", { name: "</script><b>Evil</b>" });
    const out = target();
    await exportPlanPage(repo, out, { offline: true });
    const html = readFileSync(out, "utf8");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(pagesIn(html)).toBeTruthy();
  });

  it("says which code repos it names, when a repo has been read", async () => {
    const code = groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-export-code-")));
    const repo = acmePlan(code);
    const r = await exportPlanPage(repo, target(), { offline: false });
    expect(r.notices.join("\n")).toContain("This page names the code repos acme/payments-web. Share it only with people allowed to see them.");
  });

  it("says nothing about code repos when none has been read", async () => {
    const r = await exportPlanPage(acmePlan(), target(), { offline: true });
    expect(r.notices).toEqual([]);
  });

  it("writes a plan with no areas but the company", async () => {
    const repo = mkdtempSync(join(tmpdir(), "nikos-export-empty-"));
    initPlanRepo(repo, { name: "Empty", year: "2027" });
    const out = target();
    await exportPlanPage(repo, out, { offline: true });
    expect(Object.keys(pagesIn(readFileSync(out, "utf8")))).toContain("at=company");
  });
});

describe("the export's title", () => {
  it("is plain text in the file's script, and escaped in the document head", async () => {
    const repo = mkdtempSync(join(tmpdir(), "nikos-export-title-"));
    initPlanRepo(repo, { name: "Fish & Chips", year: "2027" });
    addArea(repo, "department", "finance", { name: "Finance" });
    const out = join(repo, "page.html");
    await exportPlanPage(repo, out, { offline: true, at: "company" });
    const html = readFileSync(out, "utf8");
    expect(html).toContain("<title>Fish &amp; Chips · nikOS plan</title>");
    expect(html).toContain('"title":"Fish & Chips · nikOS plan"');
  });
});
