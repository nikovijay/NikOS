// The story map page's design parts: the header with its host label and Share, the progress overview and
// "Next to build", the release tools, moving a story between releases, and the Add a story dialog. The
// exported page keeps none of the controls.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { renderMap } from "../src/commands/map.js";
import { copyExample, edit, rootOf } from "./helpers.js";

const TOKEN = "tok3n-for-tests";
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const sample = (): string => {
  const root = rootOf(copyExample());
  made.push(root);
  return root;
};
const STORYMAP = "maps/ht/storymap.yaml";

/** One band's header, from its section to the end of its divider. */
function dividerOf(html: string, n: number): string {
  const start = html.indexOf(`id="release-${n}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('<span class="rule">', start));
}

describe("the story map page's design", () => {
  test("the live page names where it runs and offers Share; the export says it's a read-only file", () => {
    const root = sample();
    const live = renderMap(root, { live: true, token: TOKEN });
    expect(live).toContain('<span class="host-k">On this computer</span>');
    expect(live).toContain('data-open-dialog="share"');
    expect(live).toContain("its link has a private key in it");
    expect(live).toContain("nikos serve --export storymap.html");
    const exported = renderMap(root);
    expect(exported).toContain('<span class="host-k">Exported page</span>');
    expect(exported).not.toContain('<dialog id="share"');
  });

  test("the overview shows progress and the story nikos next picks", () => {
    const html = renderMap(sample());
    expect(html).toContain('<section class="overview"');
    expect(html).toMatch(/<b>1<\/b> of 3 stories done/);
    // HT-2 is in progress, so it's to finish first; HT-3 is the next todo with nothing in its way.
    expect(html).toContain('<a href="#story-HT-3"><span class="sid">HT-3</span>');
    expect(html).toContain('Finish first: <a href="#story-HT-2">HT-2</a>');
    expect(html).toMatch(/class="card todo" data-story="HT-3"[^>]*data-next/);
  });

  test("each release has reorder, rename and remove tools; remove says why it can't run", () => {
    const root = sample();
    const html = renderMap(root, { live: true, token: TOKEN });
    const r1 = dividerOf(html, 1);
    expect(r1).not.toContain('aria-label="Move release 1 earlier"');
    expect(r1).toContain('data-op="release.reorder" data-target="{&#34;release&#34;:&#34;1&#34;}"');
    expect(r1).toContain('<input type="hidden" name="to" value="2">');
    expect(r1).toContain('aria-label="Move release 1 later"');
    expect(r1).toContain('data-op="release.rename"');
    expect(r1).toContain('<button type="button" class="tool" disabled title="Move its stories to another release first"');
    const r2 = dividerOf(html, 2);
    expect(r2).toContain('aria-label="Move release 2 earlier"');
    expect(r2).not.toContain('aria-label="Move release 2 later"');

    // An empty release can be removed; one that names a bet of its own can't, and says which.
    edit(join(root, STORYMAP), (s) => s.replace("stories: [HT-3]", "stories: []"));
    expect(dividerOf(renderMap(root, { live: true, token: TOKEN }), 2)).toContain('data-op="release.remove"');
    edit(join(root, STORYMAP), (s) => s.replace("    stories: []", "    bets: [quick-win]\n    stories: []"));
    expect(dividerOf(renderMap(root, { live: true, token: TOKEN }), 2)).toContain("It delivers quick-win. Move that to another release first");
  });

  test("cards in a release can be dragged to another; the panel moves a story with story.move", () => {
    const html = renderMap(sample(), { live: true, token: TOKEN });
    expect(html).toContain('<section class="band" id="release-2" data-release="release-2" data-number="2">');
    expect(html).toMatch(/data-story="HT-1"[^>]*draggable="true"/);
    const panel = html.slice(html.indexOf('id="story-HT-1"'), html.indexOf("</aside>", html.indexOf('id="story-HT-1"')));
    expect(panel).toContain('data-op="story.move" data-target="{&#34;story&#34;:&#34;HT-1&#34;}"');
    expect(panel).toContain('<option value="2">R2 · Enhancements</option>');
    expect(panel).not.toContain('<option value="1">R1 · MVP</option></select></label></div><div class="actions"><button type="submit">Move');
    expect(panel).toContain("It goes to the end of that release's build order. Only its release tag changes");
  });

  test("Add a story opens a dialog with the activity, step, release and priority", () => {
    const html = renderMap(sample(), { live: true, token: TOKEN });
    expect(html).toContain('data-open-dialog="add-story"');
    const dialog = html.slice(html.indexOf('<dialog id="add-story"'), html.indexOf("</dialog>", html.indexOf('<dialog id="add-story"')));
    expect(dialog).toContain('data-op="story.new"');
    expect(dialog).toContain('<select name="activity" data-pick="activity">');
    expect(dialog).toContain('<option value="capture" data-activity="tasks">Manage tasks · Capture a task</option>');
    expect(dialog).toContain('<option value="2" selected>R2 · Enhancements</option>');
    expect(dialog).toContain("writes a starter feature file with no scenarios yet");
  });

  test("a story with no scenarios asks for them, with a prompt to copy on the live page", () => {
    const root = sample();
    edit(join(root, "maps/ht/features/tasks/reorder-tasks.feature"), (s) => s.slice(0, s.search(/^\s*(@\S+\s*)*Scenario/m)));
    const live = renderMap(root, { live: true });
    const panel = live.slice(live.indexOf('id="story-HT-3"'));
    expect(panel).toContain("No scenarios yet.");
    expect(panel).toContain('data-copy="Write the scenarios for HT-3');
    expect(panel).toContain("nikos clear HT-3");
    const exported = renderMap(root);
    expect(exported.slice(exported.indexOf('id="story-HT-3"'))).toContain("No scenarios yet.");
    expect(exported).not.toContain("<button");
  });

  test("the edit script posts drags as story.move and shows each story.new form's command", () => {
    const html = renderMap(sample(), { live: true, token: TOKEN });
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop() ?? "";
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('op: "story.move"');
    expect(script).toContain('"nikos story add"');
  });
});
