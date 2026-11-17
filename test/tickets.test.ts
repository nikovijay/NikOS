// nikos tickets: how a story map becomes tracker issues and epics, the export the agent reads, and the keys it
// records. The fixture map has PAY-CHK-1 and -2 (activity pay, release 1) and PAY-CHK-3 (confirm, release 2).
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { exportTickets, keysFrom, recordKeys, ticketsOf } from "../src/commands/tickets";
import { linkTicket, ticketMoves } from "../src/commands/tracker";
import { setState } from "../src/commands/state";
import { validate } from "../src/commands/validate";
import { hash } from "../src/planning/model";
import { groupRepo, readText, write } from "./planning-fixture";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp/server";
import { runOp } from "../src/planning/ops";
import { renderMap } from "../src/commands/map";
import { saveMapIn } from "../src/commands/serve";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const TICKETS = "maps/chk/tickets.yaml";
const SETTINGS = "format_version: 1\ntracker:\n  system: jira\n  project: PAY\n  statuses:\n    To Do: todo\n    In Progress: in_progress\n    Done: done\n";
/** The fixture map with Jira set up, and tickets.yaml when given. */
const repo = (tickets?: string) => {
  const g = groupRepo("PAY");
  made.push(g);
  write(join(g, "nikos.settings.yaml"), SETTINGS);
  if (tickets) write(join(g, TICKETS), tickets);
  return g;
};
const shape = (g: string) => ticketsOf(g).issues.map((i) => `${i.stories.map((s) => s.id).join("+")}→${i.epic ?? "none"}`);

describe("the rules", () => {
  it("with no tickets.yaml: one issue per story, one epic per activity, in map order", () => {
    const g = repo();
    expect(shape(g)).toEqual(["PAY-CHK-1→activity:pay", "PAY-CHK-2→activity:pay", "PAY-CHK-3→activity:confirm"]);
    expect(ticketsOf(g).epics).toEqual([{ id: "activity:pay", title: "Pay" }, { id: "activity:confirm", title: "Confirm" }]);
    expect(ticketsOf(g).issues[0].summary).toBe("Pay by card");
  });

  it("step groups a step's stories in each release; release epics are named after the release", () => {
    const g = repo("format_version: 1\nrules: { issues: step, epics: release }\n");
    expect(shape(g)).toEqual(["PAY-CHK-1+PAY-CHK-2→release:1", "PAY-CHK-3→release:2"]);
    expect(ticketsOf(g).issues[0].summary).toBe("Pay (R1)");
    expect(ticketsOf(g).epics.map((e) => e.title)).toEqual(["Release 1 · First", "Release 2 · Second"]);
  });

  it("hand changes win: a combined issue, its summary, another epic, and no epic", () => {
    const g = repo(
      [
        "format_version: 1",
        "issues:",
        "  - stories: [PAY-CHK-1, PAY-CHK-3]",
        "    summary: Pay and see it",
        "    epic: launch",
        "  - stories: [PAY-CHK-2]",
        "    epic: none",
        "epics:",
        "  - id: launch",
        "    title: Launch",
        "",
      ].join("\n"),
    );
    const t = ticketsOf(g);
    expect(shape(g)).toEqual(["PAY-CHK-1+PAY-CHK-3→launch", "PAY-CHK-2→none"]);
    expect(t.issues[0].summary).toBe("Pay and see it");
    expect(t.issues[0].releases).toEqual([1, 2]);
    expect(t.epics).toEqual([{ id: "launch", title: "Launch" }]);
  });

  it("a cancelled story gets no issue", () => {
    const g = repo();
    setState("PAY-CHK-2", "cancelled", { dir: g, reason: "Not needed" });
    expect(shape(g)).toEqual(["PAY-CHK-1→activity:pay", "PAY-CHK-3→activity:confirm"]);
  });
});

describe("the export", () => {
  it("lists epics then issues, each to create or update, with its stories, description and labels", () => {
    const g = repo("format_version: 1\nfields: { component: Web, story_ids: customfield_10042 }\nissues:\n  - stories: [PAY-CHK-1, PAY-CHK-2]\n");
    linkTicket({ id: "PAY-CHK-3", ticket: "PAY-77" }, g);
    const out = exportTickets(g);
    expect(out.tracker).toEqual({ system: "jira", project: "PAY" });
    expect(out.epics.map((e) => [e.ref, e.action])).toEqual([["activity:pay", "create"], ["activity:confirm", "create"]]);
    const [both, receipt] = out.issues;
    expect(both).toMatchObject({ ref: "PAY-CHK-1", action: "create", type: "Story", summary: "Pay by card and 1 more", epic: "activity:pay", stories: ["PAY-CHK-1", "PAY-CHK-2"], release: "R1", components: ["Web"], labels: ["nikos"] });
    expect(both.fields).toEqual({ customfield_10042: "PAY-CHK-1, PAY-CHK-2" });
    expect(both.description).toContain("PAY-CHK-1 Pay by card\nAs a shopper, I want to pay for my basket, so that I get my order\nAcceptance criteria:\n- Paying shows a receipt");
    expect(both.description).toContain("From the story map in maps/chk");
    expect(receipt).toMatchObject({ ref: "PAY-CHK-3", action: "update", key: "PAY-77", labels: ["nikos"], fields: { customfield_10042: "PAY-CHK-3" } });
  });

  it("needs the tracker project, from the settings", () => {
    const g = repo();
    write(join(g, "nikos.settings.yaml"), "format_version: 1\ntracker:\n  system: jira\n");
    expect(() => exportTickets(g)).toThrow("nikos settings set tracker.project PAY");
  });
});

describe("recording keys", () => {
  it("links each story in an issue to its key, and writes an epic's key into tickets.yaml", () => {
    const g = repo("format_version: 1\nissues:\n  - stories: [PAY-CHK-1, PAY-CHK-2]\n    summary: Pay\n");
    const r = recordKeys(g, { "PAY-CHK-1": "PAY-110", "activity:pay": "PAY-101" });
    expect(r.issues).toEqual([{ ref: "PAY-CHK-1", key: "PAY-110", stories: ["PAY-CHK-1", "PAY-CHK-2"] }]);
    const state = parse(readText(g, "maps/chk/state.yaml")).stories;
    expect(state["PAY-CHK-1"].ticket).toBe("PAY-110");
    expect(state["PAY-CHK-2"].ticket).toBe("PAY-110");
    // The file keeps what it had, and gains the epic's key.
    expect(readText(g, TICKETS)).toContain("summary: Pay\nepics:\n  - id: activity:pay\n    key: PAY-101\n");
    const out = exportTickets(g);
    expect(out.issues[0]).toMatchObject({ action: "update", key: "PAY-110" });
    expect(out.epics[0]).toMatchObject({ ref: "activity:pay", action: "update", key: "PAY-101" });
    expect(validate(g, "chk").errors).toEqual([]);
  });

  it("reads the exported file with keys filled in, and refuses an unknown ref or a key that isn't one", () => {
    const g = repo();
    const out = exportTickets(g) as any;
    // By default each story id is a label too.
    expect(out.issues[2].labels).toEqual(["nikos", "nikos-pay-chk-3"]);
    out.issues[2].key = "PAY-120";
    expect(keysFrom(out)).toEqual({ "PAY-CHK-3": "PAY-120" });
    expect(() => recordKeys(g, { "PAY-CHK-9": "PAY-1" })).toThrow("PAY-CHK-9 isn't an issue or epic in maps/chk");
    expect(() => recordKeys(g, { "PAY-CHK-1": "pay 1" })).toThrow("'pay 1' (for PAY-CHK-1) isn't a tracker key like PAY-123");
    expect(() => recordKeys(g, {})).toThrow("No keys given");
  });

  it("warns when a combined issue's stories were linked to two keys", () => {
    const g = repo("format_version: 1\nissues:\n  - stories: [PAY-CHK-1, PAY-CHK-2]\n");
    linkTicket({ id: "PAY-CHK-1", ticket: "PAY-1" }, g);
    linkTicket({ id: "PAY-CHK-2", ticket: "PAY-2" }, g);
    const t = ticketsOf(g);
    expect(t.issues[0].key).toBe("PAY-1");
    expect(t.warnings).toEqual(["PAY-CHK-1, PAY-CHK-2 are one issue but linked to PAY-1 and PAY-2: the export updates PAY-1, so close the others in the tracker"]);
  });
});

describe("tracker sync with shared tickets", () => {
  it("lists a shared ticket once, at its least advanced story", () => {
    const g = repo();
    linkTicket({ id: "PAY-CHK-1", ticket: "PAY-110" }, g);
    linkTicket({ id: "PAY-CHK-2", ticket: "PAY-110" }, g);
    setState("PAY-CHK-1", "in_progress", { dir: g });
    expect(ticketMoves(g)).toEqual([{ id: "PAY-CHK-2", ticket: "PAY-110", nikos: "todo", status: "To Do" }]);
  });
});

describe("validate", () => {
  it("names a bad tickets.yaml, a story in two issues, an unknown epic, and a story the map doesn't have", () => {
    const g = repo("format_version: 1\nrules: { issues: everything }\n");
    expect(validate(g, "chk").errors.map((e) => `${e.file}: ${e.message}`)).toContain("tickets.yaml: rules.issues must be equal to one of the allowed values");
    write(
      join(g, TICKETS),
      "format_version: 1\nissues:\n  - stories: [PAY-CHK-1]\n    epic: activity:ship\n  - stories: [PAY-CHK-1, PAY-CHK-9]\n    epic: later\n",
    );
    const v = validate(g, "chk");
    expect(v.errors.map((e) => e.message)).toEqual([
      "an issue names epic activity:ship, but the map has no activity ship",
      "PAY-CHK-1 is in more than one issue: keep each story in one",
      "an issue names epic later, which isn't in epics: add it there with a title",
    ]);
    expect(v.warnings.map((e) => e.message)).toContain("issues names PAY-CHK-9, which isn't in any release of the map: take it out of tickets.yaml");
  });
});

describe("the MCP tools", () => {
  it("tickets_export and tickets_keys do the round trip an agent makes", async () => {
    const g = repo();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await createServer(g).connect(a);
    await client.connect(b);
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
    const out = await call("tickets_export", {});
    expect(out.structuredContent.issues.map((i: any) => `${i.ref} ${i.action}`)).toEqual(["PAY-CHK-1 create", "PAY-CHK-2 create", "PAY-CHK-3 create"]);
    const keys = await call("tickets_keys", { keys: { "PAY-CHK-2": "PAY-12", "activity:confirm": "PAY-3" } });
    expect(keys.content[0].text).toBe("PAY-12 ↔ PAY-CHK-2\nPAY-3 ↔ epic activity:confirm");
    const again = await call("tickets_export", {});
    expect(again.structuredContent.issues[1]).toMatchObject({ ref: "PAY-CHK-2", action: "update", key: "PAY-12" });
    const bad = await call("tickets_keys", { keys: { "PAY-CHK-7": "PAY-1" } });
    expect(bad.isError).toBe(true);
  });
});

describe("the edits Ticketing mode sends", () => {
  /** The hash an edit to tickets.yaml expects: of the file, or of nothing before there is one. */
  const th = (g: string) => hash(existsSync(join(g, TICKETS)) ? readText(g, TICKETS) : "");
  const op = (g: string, name: string, args: Record<string, unknown>, target?: Record<string, string>) => runOp(g, { op: name, args: { map: "chk", ...args }, ...(target ? { target } : {}), expect: th(g) } as any);

  it("combine, rename, move, split: each writes tickets.yaml, and the map's own files stay as they were", () => {
    const g = repo();
    const map = readText(g, "maps/chk/storymap.yaml");
    op(g, "tickets.combine", { stories: ["PAY-CHK-1", "PAY-CHK-3"] });
    expect(shape(g)).toEqual(["PAY-CHK-1+PAY-CHK-3→activity:pay", "PAY-CHK-2→activity:pay"]);
    op(g, "tickets.rename", { summary: "Pay and see it" }, { story: "PAY-CHK-1" });
    op(g, "tickets.epic_new", { title: "Launch" });
    op(g, "tickets.epic", { epic: "launch" }, { story: "PAY-CHK-1" });
    const t = ticketsOf(g);
    expect(t.issues[0]).toMatchObject({ summary: "Pay and see it", epic: "launch" });
    expect(readText(g, TICKETS)).toBe("format_version: 1\nissues:\n  - stories: [PAY-CHK-1, PAY-CHK-3]\n    summary: Pay and see it\n    epic: launch\nepics:\n  - id: launch\n    title: Launch\n");
    op(g, "tickets.split", {}, { story: "PAY-CHK-1" });
    expect(shape(g)).toEqual(["PAY-CHK-1→activity:pay", "PAY-CHK-2→activity:pay", "PAY-CHK-3→activity:confirm"]);
    expect(readText(g, "maps/chk/storymap.yaml")).toBe(map);
    expect(validate(g, "chk").errors).toEqual([]);
  });

  it("rules, fields and keys", () => {
    const g = repo();
    op(g, "tickets.rules", { issues: "step", epics: "release" });
    expect(shape(g)).toEqual(["PAY-CHK-1+PAY-CHK-2→release:1", "PAY-CHK-3→release:2"]);
    op(g, "tickets.fields", { issue_type: "Task", component: "Web", story_ids: "customfield_10042" });
    expect(ticketsOf(g).fields).toMatchObject({ issueType: "Task", component: "Web", storyIds: "customfield_10042" });
    op(g, "tickets.fields", { component: "" });
    expect(readText(g, TICKETS)).not.toContain("component");
    // The page sends the keys as the lines of its text box.
    runOp(g, { op: "tickets.keys", args: { map: "chk", keys: ["{", '"PAY-CHK-1": "PAY-110",', '"release:1": "PAY-100" }'] } } as any);
    expect(exportTickets(g).issues[0]).toMatchObject({ action: "update", key: "PAY-110", epic: "release:1" });
    expect(exportTickets(g).epics[0]).toMatchObject({ ref: "release:1", key: "PAY-100" });
  });

  it("refuses what doesn't make sense, and a page that loaded before the file changed", () => {
    const g = repo();
    expect(() => op(g, "tickets.combine", { stories: ["PAY-CHK-1"] })).toThrow("Pick at least two stories");
    expect(() => op(g, "tickets.split", {}, { story: "PAY-CHK-1" })).toThrow("PAY-CHK-1 is already one story's issue");
    expect(() => op(g, "tickets.epic", { epic: "later" }, { story: "PAY-CHK-1" })).toThrow("There is no epic later: make it first");
    expect(() => op(g, "tickets.fields", { issue_type: "" })).toThrow("The issue type can't be blank");
    expect(() => op(g, "tickets.fields", { story_ids: "story" })).toThrow("customfield_10042");
    const stale = th(g);
    op(g, "tickets.rules", { epics: "none" });
    expect(() => runOp(g, { op: "tickets.rules", args: { map: "chk", epics: "release" }, expect: stale } as any)).toThrow();
  });

  it("the story map page may send them", () => {
    const g = repo();
    expect(saveMapIn(g, { op: "tickets.combine", map: "chk" }).area).toBe("chk");
    expect(() => saveMapIn(g, { op: "plan.okr", map: "chk" })).toThrow("isn't a change the story map makes");
  });
});

describe("Ticketing mode on the page", () => {
  const TOKEN = "t0ken";
  it("comes with editing: the switch, each card's issue, and the panel's Issues, Export and Fields", () => {
    const g = repo("format_version: 1\nissues:\n  - stories: [PAY-CHK-1, PAY-CHK-2]\n    summary: Pay\n");
    linkTicket({ id: "PAY-CHK-3", ticket: "PAY-77" }, g);
    const html = renderMap(g, { live: true, token: TOKEN });
    expect(html).toContain('data-mode="tickets"');
    expect(html).toMatch(/data-story="PAY-CHK-1"[^>]*data-issue="PAY-CHK-1"[^>]*data-shared/);
    expect(html).toContain('<span class="tk-badge" title="Issue 1, not in the tracker yet, with 1 more story">#1 · 2</span><span class="tk-new">New</span>');
    expect(html).toContain('title="Issue 2, PAY-77">#2</span>');
    expect(html).toContain('data-tk-tab="export"');
    expect(html).toContain("&#34;format&#34;: &#34;nikos-tickets/1&#34;");
    expect(html).toContain("Using the Jira MCP, in project PAY: create the 3 marked create");
    expect(html).toContain('data-op="tickets.fields"');
    expect(html).toContain(`data-tickets="${hash("format_version: 1\nissues:\n  - stories: [PAY-CHK-1, PAY-CHK-2]\n    summary: Pay\n")}"`);
    // The exported page and the read-only one have none of it.
    expect(renderMap(g)).not.toContain("tk-badge");
    expect(renderMap(g, { live: true })).not.toContain('data-mode="tickets"');
  });

  it("says how to name the tracker project when there's none, and shows a tickets.yaml that doesn't read", () => {
    const g = repo();
    write(join(g, "nikos.settings.yaml"), "format_version: 1\n");
    expect(renderMap(g, { live: true, token: TOKEN })).toContain("No tracker project yet: <code>nikos settings set tracker.project PAY</code>");
    write(join(g, TICKETS), "format_version: 1\nrules: { issues: everything }\n");
    const html = renderMap(g, { live: true, token: TOKEN });
    expect(html).toContain("maps/chk/tickets.yaml: rules.issues must be equal to one of the allowed values. Fix the file, then reload the page.");
    expect(html).toContain('data-story="PAY-CHK-1"');
  });
});
