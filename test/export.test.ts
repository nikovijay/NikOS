import { describe, it, expect } from "vitest";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { exportMap } from "../src/commands/export";
import { setState } from "../src/commands/state";
import { copyExample, edit, rootOf } from "./helpers";

describe("export", () => {
  it("writes a PRD with each release's goal, stories, facts and criteria", () => {
    const dir = copyExample();
    setState("HT-3", "cancelled", { dir, reason: "Drag and drop can wait" });
    const prd = exportMap(dir, "prd");
    expect(prd).toContain("# hello-todo: product requirements");
    expect(prd).toContain("## Release 1: MVP\n\n**Goal:** Capture tasks and see only today's top three.\n\n**Delivers:** fewer-missed-tasks\n\n1 of 2 stories done.");
    expect(prd).toContain("Status: Done · Priority: must · Effort: S · Activity: Manage tasks › Capture a task");
    expect(prd).toContain("- AC1: Adding a task shows it at the top (must)");
    expect(prd).toContain("## Cancelled\n\n- HT-3: Reorder tasks. Drag and drop can wait");
    expect(prd).not.toContain("### HT-3");
  });

  it("writes Linear issues with priority, estimate, state, milestone, labels and blockers", () => {
    const dir = copyExample();
    edit(join(dir, "features/tasks/reorder-tasks.feature"), (s) => s.replace("@HT-3", "@HT-3 @depends-HT-2 @type-technical"));
    const linear = JSON.parse(exportMap(dir, "linear"));
    expect(linear.milestones[0]).toEqual({ name: "Release 1: MVP", description: "Capture tasks and see only today's top three." });
    expect(linear.issues.map((i: any) => i.externalId)).toEqual(["HT-1", "HT-2", "HT-3"]);
    expect(linear.issues[2]).toMatchObject({
      title: "HT-3 Reorder tasks",
      priority: 3,
      estimate: 2,
      stateName: "Todo",
      milestoneName: "Release 2: Enhancements",
      labelNames: ["Manage tasks", "Organise the list", "Technical"],
      blockedBy: ["HT-2"],
    });
    expect(linear.issues[0].description).toContain("### Acceptance criteria\n1. AC1: Adding a task shows it at the top (must)");
  });

  it("writes a Jira bulk-create body for one release, with a project key", () => {
    const jira = JSON.parse(exportMap(copyExample(), "jira", { release: 2, projectKey: "TODO" }));
    expect(jira.issueUpdates).toHaveLength(1);
    expect(jira.issueUpdates[0].fields).toMatchObject({
      project: { key: "TODO" },
      summary: "HT-3 Reorder tasks",
      issuetype: { name: "Story" },
      priority: { name: "Medium" },
      labels: ["nikos-ht-3", "release-2", "tasks", "organise", "status-todo"],
    });
    expect(jira.issueUpdates[0].fields.description).toContain("h3. Acceptance criteria");
    expect(JSON.parse(exportMap(copyExample(), "jira")).issueUpdates[0].fields.project.key).toBe("HT");
  });

  it("refuses an unknown format or release", () => {
    expect(() => exportMap(copyExample(), "csv" as any)).toThrow("'csv' is not a format (prd, linear, jira)");
    expect(() => exportMap(copyExample(), "prd", { release: 4 })).toThrow("There is no release 4");
  });

  it("needs --map when the repo has several story maps", () => {
    const dir = copyExample();
    const root = rootOf(dir);
    cpSync(dir, join(root, "maps/zz"), { recursive: true });
    expect(() => exportMap(root, "prd")).toThrow("several story maps");
    expect(exportMap(root, "prd", { map: "ht" })).toContain("# hello-todo: product requirements");
  });
});
