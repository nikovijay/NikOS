// The author's N mark at the top of both pages: the plan dashboard (live and exported) and the story map.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_MARK } from "../src/lib/design.js";
import { renderMap } from "../src/commands/map.js";
import { exportPlanPage } from "../src/plan/serve";
import { acmePlan } from "./plan-serve-fixture";
import { copyExample, rootOf } from "./helpers.js";

const markIn = (html: string) => /<span class="brand-mark" aria-hidden="true">([\s\S]*?)<\/span>/.exec(html)?.[1];

describe("the brand mark", () => {
  it("is the N mark from assets/icon.svg", () => {
    const icon = readFileSync(join(__dirname, "../assets/icon.svg"), "utf8");
    for (const d of [...BRAND_MARK.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!)) expect(icon).toContain(d);
    expect(BRAND_MARK).toContain('fill="currentColor"');
  });

  it("heads the story map, live and exported", () => {
    const root = rootOf(copyExample());
    try {
      expect(markIn(renderMap(root, { live: true, token: "t" }))).toBe(BRAND_MARK);
      expect(markIn(renderMap(root))).toBe(BRAND_MARK);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("heads the plan dashboard's exported pages", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "nikos-mark-")), "plan.html");
    await exportPlanPage(acmePlan(), out, { offline: true });
    const html = readFileSync(out, "utf8").replace(/\\"/g, '"').replace(/\\\//g, "/");
    expect(html).toContain(`<span class="brand-mark" aria-hidden="true">${BRAND_MARK}</span>`);
  });
});
