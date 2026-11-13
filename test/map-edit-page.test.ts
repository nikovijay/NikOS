// The live story map's edit forms: the page nikos serve gives with its token. Each form posts one op with the
// hash of the file the page loaded, and the page is only editable with a token. The exported page has none of it.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { renderMap } from "../src/commands/map.js";
import { hash } from "../src/planning/model.js";
import { copyExample, edit, rootOf } from "./helpers.js";

const TOKEN = "tok3n-for-tests";
/** The temp maps a test makes, removed after it. */
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** A copy of the example map, with the test's cleanup. */
const sample = (): string => {
  const root = rootOf(copyExample());
  made.push(root);
  return root;
};
const FEATURE = "maps/ht/features/tasks/add-a-task.feature";
const STORYMAP = "maps/ht/storymap.yaml";

/** The hash of a file as the page loads it. */
const hashOf = (root: string, rel: string) => hash(readFileSync(join(root, rel), "utf8"));

/** The markup of one story's panel, from its id to the end of its sheet. */
function panelOf(html: string, id: string): string {
  const start = html.indexOf(`id="story-${id}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</aside>", start));
}

/** The markup of one band, from its id to the next band or the end of the board. */
function bandOf(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('<section class="band"', start + 1);
  const end = next > -1 ? next : html.indexOf("</main>", start);
  return html.slice(start, end);
}

/** The page's own script, the last script block: the edit script when the page is editable. */
function lastScript(html: string): string {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return blocks[blocks.length - 1] ?? "";
}

describe("the editable story map page", () => {
  test("with a token, the page carries the token, the save bar and the edit forms", () => {
    const html = renderMap(sample(), { live: true, token: TOKEN });
    expect(html).toContain(`<meta name="nikos-token" content="${TOKEN}">`);
    expect(html).toContain('<body class="editing" data-map="ht" data-storymap="');
    expect(html).toContain('<div id="pending" class="pending" role="status" hidden></div>');
    expect(html).toContain("Is nikos serve still running?");
    expect(html).toContain(".pending{");
    expect(html.match(/data-op="story\.edit"/g)).toHaveLength(3);
    expect(html.match(/data-op="scenario\.edit"/g)).toHaveLength(4);
  });

  test("without a token the page has no edit forms, no save bar and no script of its own", () => {
    // The live page keeps its filters, which have their own selects and inputs; none of the edit markup is there.
    const live = renderMap(sample(), { live: true });
    for (const tag of ["nikos-token", 'id="pending"', 'class="editing"', "data-op=", "<form", 'type="submit"', "<textarea", "/api/op"]) {
      expect(live).not.toContain(tag);
    }
    // The exported page has none of the live page's controls either.
    const exported = renderMap(sample());
    for (const tag of ["nikos-token", 'id="pending"', "data-op=", "<form", "<button", "<select", "<textarea", "<input", "<script"]) {
      expect(exported).not.toContain(tag);
    }
  });

  test("the page's script parses", () => {
    const html = renderMap(sample(), { live: true, token: TOKEN });
    expect(() => new Function(lastScript(html))).not.toThrow();
    expect(lastScript(html)).toContain("/api/op");
  });

  test("each add button posts its op, with the storymap hash the page loaded", () => {
    const root = sample();
    const html = renderMap(root, { live: true, token: TOKEN });
    const storymap = hashOf(root, STORYMAP);
    expect(html).toContain(`data-op="activity.new" data-target="{}" data-expect="${storymap}"`);
    expect(html).toContain(`data-op="release.new" data-target="{}" data-expect="${storymap}"`);
    // The step's form names its activity, and each cell's story form names the cell's activity and step.
    expect(html).toContain(`data-op="step.new" data-target="{}" data-expect="${storymap}"`);
    expect(html).toContain('<input type="hidden" name="activity" value="tasks">');
    const capture = html.slice(html.indexOf('data-step-id="capture"'), html.indexOf('data-step-id="focus"'));
    expect(capture).toContain(`data-op="story.new"`);
    expect(capture).toContain('<input type="hidden" name="release" value="1">');
    expect(capture).toContain('<input type="hidden" name="activity" value="tasks">');
    expect(capture).toContain('<input type="hidden" name="step" value="capture">');
    // One form in each of the six cells, and one in the Add a story dialog.
    expect(html.match(/data-op="story\.new" data-target/g)).toHaveLength(7);
  });

  test("the cells of an unreleased band pick a release, the last one by default", () => {
    const root = sample();
    // HT-3 leaves release 2's list: it is then a story no release names, so it sits in the unreleased band.
    edit(join(root, STORYMAP), (s) => s.replace("stories: [HT-3]", "stories: []"));
    const html = renderMap(root, { live: true, token: TOKEN });
    const band = bandOf(html, "unreleased");
    expect(band).toContain('<select name="release">');
    expect(band).toContain('<option value="2" selected>R2 · Enhancements</option>');
    expect(band).not.toContain('<input type="hidden" name="release"');
    expect(band).toContain('data-op="story.new"');
  });

  test("a release's cells add a story to that release, and the page has a + Release after the last band", () => {
    const root = sample();
    const html = renderMap(root, { live: true, token: TOKEN });
    expect(bandOf(html, "release-2")).toContain('<input type="hidden" name="release" value="2">');
    expect(html.indexOf('data-op="release.new"')).toBeGreaterThan(html.indexOf('id="release-2"'));
  });

  test("a story's panel is filled from its feature file: details, placement and each criterion", () => {
    const root = sample();
    const html = renderMap(root, { live: true, token: TOKEN });
    const panel = panelOf(html, "HT-1");
    const feature = hashOf(root, FEATURE);
    // The details: the title and the narrative parts as the file has them, and the type and priority picked.
    expect(panel).toContain(`data-op="story.edit" data-target="{&#34;story&#34;:&#34;HT-1&#34;}" data-expect="${feature}" data-edit`);
    expect(panel).toContain('<input name="title" value="Add a task" required data-changed>');
    expect(panel).toContain('<span>As a</span><input name="as_a" value="a busy person" placeholder="a first user" data-changed>');
    expect(panel).toContain('<input name="i_want" value="to add a task in one step" data-changed>');
    expect(panel).toContain('<input name="so_that" value="capturing it is faster than forgetting it" data-changed>');
    expect(panel).toContain('<option value="user_story" selected>User story</option>');
    expect(panel).toContain('<option value="must" selected>Must</option>');
    // The placement: the release, the activity, and the step of that activity.
    expect(panel).toContain(`data-op="story.place" data-target="{&#34;story&#34;:&#34;HT-1&#34;}" data-expect="${feature}" data-edit`);
    expect(panel).toContain('<option value="1" selected>R1 · MVP</option>');
    expect(panel).toContain('<option value="tasks" selected>Manage tasks</option>');
    expect(panel).toContain('<option value="capture" selected data-activity="tasks">');
    expect(panel).toContain('<option value="focus" data-activity="tasks">');
    // The criteria: each has an edit form with its steps, a remove button that asks first, and an add form.
    expect(panel).toContain(`data-op="scenario.edit" data-target="{&#34;story&#34;:&#34;HT-1&#34;}" data-expect="${feature}" data-edit`);
    expect(panel).toContain('<input type="hidden" name="ac" value="AC1">');
    expect(panel).toContain('<textarea name="given" data-list="lines" rows="3">my list is empty</textarea>');
    expect(panel).toContain('<textarea name="when" data-list="lines" rows="3" required>I add the task &#34;Call the bank&#34;</textarea>');
    expect(panel).toContain('data-op="scenario.remove"');
    expect(panel).toContain('data-confirm="Remove AC1 from HT-1? Its steps go with it."');
    expect(panel).toContain(`data-op="scenario.add" data-target="{&#34;story&#34;:&#34;HT-1&#34;}" data-expect="${feature}"`);
    expect(html.match(/data-op="scenario\.remove"/g)).toHaveLength(4);
  });

  test("a done story says a change needs sign-off again, and a story in progress doesn't", () => {
    const root = sample();
    const html = renderMap(root, { live: true, token: TOKEN });
    expect(panelOf(html, "HT-1")).toContain("needs signing off again");
    expect(panelOf(html, "HT-2")).not.toContain("needs signing off again");
  });

  test("a story with no feature file can't be edited, and its panel says so", () => {
    const root = sample();
    rmSync(join(root, "maps/ht/features/tasks/reorder-tasks.feature"));
    const html = renderMap(root, { live: true, token: TOKEN });
    const panel = panelOf(html, "HT-3");
    expect(panel).toContain("This story has no feature file yet, so it can't be edited here.");
    expect(panel).not.toContain("<form");
  });

  test("a feature file that doesn't parse can't be edited, and its panel says so", () => {
    const root = sample();
    // Without its Feature: line the file doesn't parse as Gherkin at all.
    edit(join(root, FEATURE), (s) => s.replace("Feature: Add a task", "Scenario: Add a task"));
    const html = renderMap(root, { live: true, token: TOKEN });
    expect(panelOf(html, "HT-1")).toContain("has a Gherkin error, so it can't be edited here until that's fixed.");
    expect(panelOf(html, "HT-1")).not.toContain("<form");
  });

  test("the story's text is escaped in the forms' fields", () => {
    const root = sample();
    edit(join(root, FEATURE), (s) => s.replace("Feature: Add a task", 'Feature: Add a "quoted" <b>task</b>'));
    const html = renderMap(root, { live: true, token: TOKEN });
    expect(html).not.toContain("<b>task</b>");
    expect(html).toContain('<input name="title" value="Add a &#34;quoted&#34; &#60;b&#62;task&#60;/b&#62;" required data-changed>');
  });

  test("personas appear in the details' select, and + New persona posts persona.new", () => {
    const root = sample();
    edit(join(root, STORYMAP), (s) => s.replace("activities:", "personas:\n  - id: planner\n    title: Weekly planner\nactivities:"));
    edit(join(root, FEATURE), (s) => s.replace("@HT-1 ", "@HT-1 @persona-planner "));
    const html = renderMap(root, { live: true, token: TOKEN });
    const panel = panelOf(html, "HT-1");
    expect(panel).toContain('<select name="personas" multiple data-changed><option value="planner" selected>Weekly planner</option></select>');
    expect(panel).toContain(`data-op="persona.new" data-target="{}" data-expect="${hashOf(root, STORYMAP)}"`);
  });

  test("the edit forms and their styles stay readable in light and dark, and collapse on a phone", () => {
    const html = renderMap(sample(), { live: true, token: TOKEN });
    expect(html).toContain(':root[data-theme="dark"]{--bg:#121118');
    expect(html).toContain(".cell:empty { display: none; }");
    expect(html).toContain(".editing .spine { display: block;");
    expect(html).toContain(".op button");
  });
});

describe("the edit forms' choices and labels", () => {
  test("a story and a criterion with no priority show a blank choice that can't be picked again, and no Won't", () => {
    const root = sample();
    edit(join(root, FEATURE), (s) => s.replace("@release-1 @must ", "@release-1 ").replace("  @AC2 @should", "  @AC2"));
    const html = renderMap(root, { live: true, token: TOKEN });
    const panel = panelOf(html, "HT-1");
    expect(panel).toContain('<option value="" selected disabled>No priority yet</option>');
    expect(panel).toContain('<option value="" selected disabled>No priority of its own</option>');
    expect(panel).not.toContain('<option value="must" selected>Must</option></select></label><label class="fld wide"><span>Personas');
    expect(panel).not.toContain("Won't");
  });

  test("a Scenario Outline can be removed in the panel, but its steps aren't edited there", () => {
    const root = sample();
    const outline = [
      '  @AC2 @should',
      '  Scenario Outline: AC2 — Blank tasks are ignored',
      '    Given my list is <list>',
      '    When I add the task ""',
      '    Then my list is still <list>',
      '',
      '    Examples:',
      '      | list  |',
      '      | empty |',
      '',
    ].join("\n");
    edit(join(root, FEATURE), (s) => s.slice(0, s.indexOf("  @AC2")) + outline);
    const html = renderMap(root, { live: true, token: TOKEN });
    const panel = panelOf(html, "HT-1");
    expect(panel.match(/data-op="scenario\.edit"/g)).toHaveLength(1);
    expect(panel).toContain("A Scenario Outline. Its steps are changed in the feature file; it can be removed here.");
    expect(panel).toContain('data-op="scenario.remove"');
  });

  test("a story in no release gets a release choice that leaves it unreleased when it's blank", () => {
    const root = sample();
    edit(join(root, STORYMAP), (s) => s.replace("stories: [HT-1, HT-2]", "stories: [HT-2]"));
    const html = renderMap(root, { live: true, token: TOKEN });
    const panel = panelOf(html, "HT-1");
    expect(panel).toContain('<select name="release"><option value="" selected>Not in a release yet</option><option value="1">R1 · MVP</option>');
  });

  test("the + buttons name their place for a screen reader, and the quiet ones are not faded", () => {
    const html = renderMap(sample(), { live: true, token: TOKEN });
    expect(html).toContain('aria-label="Add a story to Manage tasks · Capture a task, release 1"');
    expect(html).toContain('aria-label="Add a step to Manage tasks"');
    expect(html).toContain('aria-label="Add an activity"');
    expect(html).toContain('aria-label="Add a release"');
    // The quiet "+" is not faded: its rule has no opacity (the disabled button's is a different rule).
    expect(html).not.toMatch(/\.add > summary \{[^}]*opacity/);
  });

  test("the details form sends only the fields the person changed", () => {
    const html = renderMap(sample(), { live: true, token: TOKEN });
    expect(lastScript(html)).toContain('f.hasAttribute("data-changed") && !changed(f)');
    expect(lastScript(html)).toContain("function changed(f)");
  });
});
