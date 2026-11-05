import { dirname } from "node:path";
import { describe, expect, test } from "vitest";
import { copyExample } from "./helpers.js";
import { renderMap } from "../src/commands/map.js";

describe("story map view", () => {
  test("activities are columns and releases are bands with status", () => {
    const html = renderMap(dirname(copyExample()));
    expect(html).toContain("Release 1 · MVP");
    expect(html).toContain("Release 2 · Enhancements");
    expect(html.match(/class="cell-head">Manage tasks</g)).toHaveLength(1);

    const release1 = html.slice(html.indexOf('id="release-1"'), html.indexOf('id="release-2"'));
    expect(release1).toMatch(/class="card done" data-story="HT-1"/);
    expect(release1).toMatch(/class="card doing" data-story="HT-2"/);
    expect(release1).not.toContain('data-story="HT-3"');
    expect(html.slice(html.indexOf('id="release-2"'))).toMatch(/class="card todo" data-story="HT-3"/);
  });

  test("has nothing to edit", () => {
    const html = renderMap(dirname(copyExample()));
    for (const tag of ["<form", "<input", "<button", "<textarea", "<select", "contenteditable", "<script"]) {
      expect(html).not.toContain(tag);
    }
  });
});
