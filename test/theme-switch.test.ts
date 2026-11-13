// The light/dark switch: the plan dashboard, its offline export and the story map each have it, with the
// script in the head that applies a kept choice before the page draws. Dark rules apply under the browser's
// dark setting unless light was chosen, and whenever dark was chosen.
import { afterEach, describe, expect, it } from "vitest";
import { renderMap } from "../src/commands/map";
import { darkRules, THEME_BUTTON, THEME_HEAD, THEME_JS } from "../src/lib/theme";
import { offlineDocument } from "../src/plan/offline";
import { startPlanServe, type PlanServe } from "../src/plan/serve";
import { copyExample, rootOf } from "./helpers";
import { acmePlan } from "./plan-serve-fixture";

let open: PlanServe[] = [];
afterEach(async () => {
  await Promise.all(open.map((p) => p.srv.close()));
  open = [];
});

const headOf = (html: string) => html.slice(0, html.indexOf("</head>"));

describe("the light/dark switch", () => {
  it("is on the plan dashboard, with its script in the head", async () => {
    const plan = await startPlanServe(acmePlan(), { port: 0, offline: true });
    open.push(plan);
    const html = await fetch(`http://127.0.0.1:${plan.srv.port}/?at=departments/finance`).then((r) => r.text());
    expect(headOf(html)).toContain(THEME_HEAD);
    expect(html).toContain(THEME_BUTTON);
    expect(html).toContain(':root[data-theme="dark"]');
  });

  it("is on the offline export, in its one script, so it keeps working when the page changes", () => {
    const html = offlineDocument({ a: { title: "A", body: `<header class="top">${THEME_BUTTON}</header>` } }, "a");
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain(THEME_JS);
  });

  it("is on the live story map; the exported one has no script, and follows the browser", () => {
    const root = rootOf(copyExample());
    const live = renderMap(root, { live: true });
    expect(headOf(live)).toContain(THEME_HEAD);
    expect(live).toContain(THEME_BUTTON);
    const saved = renderMap(root);
    expect(saved).not.toContain("<script");
    expect(saved).not.toContain(THEME_BUTTON);
    for (const html of [live, saved]) {
      expect(html).toContain(':root[data-theme="dark"]{--bg:#121118');
      expect(html).toContain(':root:not([data-theme="light"]){--bg:#121118');
    }
  });

  it("scopes each dark rule to the browser's dark setting and to a dark choice", () => {
    expect(darkRules(":root { --a: 1; } .card, .x { --b: 2; }")).toBe(
      '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){ --a: 1; }:root:not([data-theme="light"]) .card,:root:not([data-theme="light"]) .x{ --b: 2; }}' +
        ':root[data-theme="dark"]{ --a: 1; }:root[data-theme="dark"] .card,:root[data-theme="dark"] .x{ --b: 2; }',
    );
  });

  it("parses: the head's script is one valid function", () => {
    expect(() => new Function(THEME_JS)).not.toThrow();
  });
});
