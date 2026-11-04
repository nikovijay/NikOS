import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain JavaScript build script
import { TAGLINE, renderSite } from "../scripts/build-site.mjs";

const site = join(__dirname, "../site");
const read = (f: string) => readFileSync(join(site, f), "utf8");
const packs: { id: string; name: string; page: string; install: string }[] = JSON.parse(read("packs.json"));
const html = read("index.html");

describe("nikos.tools homepage", () => {
  it("explains nikOS in one line and links every pack to its page", () => {
    expect(TAGLINE.split(/[.!?](\s|$)/).filter((s: string) => s.trim()).length).toBe(1);
    expect(html).toContain(`<h1>${TAGLINE}</h1>`);
    expect(packs.length).toBeGreaterThan(0);
    for (const p of packs) {
      const card = new RegExp(`<li class="pack" id="${p.id}">[\\s\\S]*?<h3>${p.name}</h3>[\\s\\S]*?<a class="more" href="${p.page.replace(/[.?+*()[\]]/g, "\\$&")}">`);
      expect(html, p.id).toMatch(card);
      expect(p.page, p.id).toMatch(/^(https:\/\/|\/)/);
    }
    for (const asset of ["tokens.css", "style.css", "header.svg", "icon.svg"]) expect(existsSync(join(site, asset)), asset).toBe(true);
  });

  it("is the page the build script makes from packs.json", () => {
    expect(html).toBe(renderSite(packs));
  });

  it("has nothing wider than a phone screen", () => {
    const css = read("style.css");
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    // No fixed width or min-width above 320px; the content column caps itself with max-width.
    for (const m of css.matchAll(/(?:^|[;{\s])(width|min-width):\s*(\d+)px/g)) expect(Number(m[2]), m[0]).toBeLessThanOrEqual(320);
    expect(css).toMatch(/\.wrap \{[^}]*padding: 0 16px/);
    expect(css).toMatch(/minmax\(min\(100%, /);
    // Long install commands scroll inside their own box instead of widening the page.
    expect(css).toMatch(/\.install \{[^}]*overflow-x: auto/);
    expect(css).toMatch(/\.hero img \{[^}]*width: 100%/);
  });

  it("uses the Signal design system tokens and credits them", () => {
    const tokens = read("tokens.css");
    expect(tokens).toMatch(/@archetypeai\/ds-lib-tokens 0\.21\.0, MIT License/);
    for (const t of ["--background", "--foreground", "--card", "--muted-foreground", "--border", "--radius"]) expect(tokens).toContain(`${t}:`);
    expect(html).toContain("Signal Design System by Archetype AI");
  });
});
