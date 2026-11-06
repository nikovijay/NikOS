import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { copyExample, edit } from "./helpers.js";
import { renderMap } from "../src/commands/map.js";

describe("story map view", () => {
  test("activities are columns and releases are bands with status", () => {
    const html = renderMap(dirname(copyExample()));
    expect(html).toContain("Release 1 · MVP");
    expect(html).toContain("Release 2 · Enhancements");
    expect(html.match(/<strong>Manage tasks<\/strong>/g)).toHaveLength(1);

    const release1 = html.slice(html.indexOf('id="release-1"'), html.indexOf('id="release-2"'));
    expect(release1).toMatch(/class="card done" data-story="HT-1"/);
    expect(release1).toMatch(/class="card doing" data-story="HT-2"/);
    expect(release1).not.toContain('data-story="HT-3"');
    expect(html.slice(html.indexOf('id="release-2"'), html.indexOf('<div class="sheet-wrap"'))).toMatch(/class="card todo" data-story="HT-3"/);
  });

  test("bands are numbered with a tally, and a release whose stories are all done is stamped", () => {
    const root = dirname(copyExample());
    const html = renderMap(root);
    const release1 = html.slice(html.indexOf('id="release-1"'), html.indexOf('id="release-2"'));
    expect(release1).toContain('<span class="rnum">01</span>');
    expect(release1).toContain("1 done · 1 in progress · 0 to do");
    expect(release1).not.toContain('class="stamp"');
    edit(join(root, "intent", "state.yaml"), (s) => s.replace("status: in_progress", "status: done"));
    const shipped = renderMap(root);
    expect(shipped.slice(shipped.indexOf('id="release-1"'), shipped.indexOf('id="release-2"'))).toContain('<span class="stamp">Shipped</span>');
  });

  test("a story with blockers reads as blocked", () => {
    const root = dirname(copyExample());
    edit(join(root, "intent", "state.yaml"), (s) => s.replace("blockers: []", "blockers: [Waiting on the API]"));
    expect(renderMap(root)).toMatch(/class="card blocked" data-story="HT-2"/);
  });

  test("each story opens a panel with its narrative and criteria", () => {
    const html = renderMap(dirname(copyExample()));
    expect(html).toContain('href="#story-HT-1"');
    const panel = html.slice(html.indexOf('id="story-HT-1"'));
    expect(panel).toContain("As a busy person, I want to add a task in one step, so that capturing it is faster than forgetting it");
    expect(panel).toMatch(/<span class="sid">AC1<\/span>Adding a task shows it at the top <span class="prio">must<\/span>/);
    expect(html).toMatch(/data-story="HT-1"[^>]*>.*?2 criteria · 1 must/);
  });

  test("has nothing to edit", () => {
    const html = renderMap(dirname(copyExample()));
    for (const tag of ["<form", "<input", "<button", "<textarea", "<select", "contenteditable", "<script"]) {
      expect(html).not.toContain(tag);
    }
  });
});
