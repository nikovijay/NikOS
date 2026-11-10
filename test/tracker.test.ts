import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { importTickets, linkTicket, recordTicket, ticketMoves } from "../src/commands/tracker";
import { init } from "../src/commands/init";
import { setupVerify } from "../src/commands/verify";
import { setState } from "../src/commands/state";
import { validate } from "../src/commands/validate";
import { storyMapOf } from "../src/commands/map";
import { copyExample, rootOf } from "./helpers";

const JIRA = `format_version: 1
tracker:
  system: jira
  site: acme.atlassian.net
  project: PAY
  statuses:
    To Do: todo
    In Progress: in_progress
    Done: done
    Accepted: approved
    Won't Do: cancelled
`;
const state = (intent: string) => parse(readFileSync(join(intent, "state.yaml"), "utf8")).stories;
const jiraRepo = (settings = JIRA) => {
  const intent = copyExample();
  writeFileSync(join(rootOf(intent), "nikos.settings.yaml"), settings);
  return intent;
};

describe("tracker", () => {
  it("links stories to tickets and says which tickets should move", () => {
    const intent = jiraRepo();
    linkTicket({ id: "HT-1", ticket: "PAY-1" }, intent);
    linkTicket({ id: "HT-2", ticket: "PAY-2" }, intent);
    expect(state(intent)["HT-1"].ticket).toBe("PAY-1");
    expect(validate(intent).errors).toEqual([]);
    expect(ticketMoves(rootOf(intent))).toEqual([
      { id: "HT-1", ticket: "PAY-1", nikos: "done", status: "Done" },
      { id: "HT-2", ticket: "PAY-2", nikos: "in_progress", status: "In Progress" },
    ]);
    expect(() => linkTicket({ id: "HT-9", ticket: "PAY-9" }, rootOf(intent))).toThrow("no story map has HT-9");
  });

  it("never copies done from a ticket, cancels on the tracker's word, and refuses an unmapped status", () => {
    const intent = jiraRepo();
    linkTicket({ id: "HT-2", ticket: "PAY-2" }, intent);
    expect(recordTicket({ id: "HT-2", status: "Done" }, intent)).toMatchObject({ outcome: "differs", means: "done" });
    expect(state(intent)["HT-2"].status).toBe("in_progress");
    expect(recordTicket({ id: "HT-2", status: "In Progress" }, intent).outcome).toBe("in step");
    expect(recordTicket({ id: "HT-3", status: "Won't Do", by: "Ana" }, intent)).toMatchObject({ outcome: "cancelled" });
    expect(state(intent)["HT-3"]).toMatchObject({ status: "cancelled", cancelled_reason: "Cancelled in jira by Ana" });
    expect(() => recordTicket({ id: "HT-2", status: "Blocked" }, intent)).toThrow("'Blocked' isn't mapped to a nikOS status");
    expect(recordTicket({ id: "HT-1", status: "Accepted", by: "Ana" }, intent)).toMatchObject({ outcome: "ignored" });
    expect(() => recordTicket({ id: "HT-1", status: "Done" }, copyExample())).toThrow("No tracker is set up here");
  });

  it("imports a backlog as linked todo stories, grouped into activities, once", () => {
    const intent = jiraRepo();
    const tickets = [
      { key: "PAY-10", title: "Pay by card", group: "Checkout" },
      { key: "PAY-11", title: "Save a card", group: "Checkout" },
      { key: "PAY-12", title: "Refund a payment" },
    ];
    expect(importTickets(tickets, intent, { release: 2 }).added).toEqual([
      { id: "HT-4", ticket: "PAY-10" },
      { id: "HT-5", ticket: "PAY-11" },
      { id: "HT-6", ticket: "PAY-12" },
    ]);
    const map = storyMapOf(intent);
    expect(map.activities.map((a) => a.id)).toEqual(["tasks", "checkout", "backlog"]);
    expect(map.releases[1].stories.map((s) => [s.id, s.activity, s.status])).toEqual([["HT-3", "tasks", "todo"], ["HT-4", "checkout", "todo"], ["HT-5", "checkout", "todo"], ["HT-6", "backlog", "todo"]]);
    expect(validate(intent).errors).toEqual([]);
    expect(importTickets(tickets, intent)).toEqual({ added: [], skipped: ["PAY-10", "PAY-11", "PAY-12"] });
  });

  it("approves from the tracker when tracker approvals count, recording who moved the ticket", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-tracker-"));
    init(root, { name: "Fixture", key: "FX" });
    writeFileSync(join(root, "package.json"), '{"name":"fx","private":true}');
    symlinkSync(join(__dirname, "../node_modules"), join(root, "node_modules"));
    setupVerify(root);
    writeFileSync(
      join(root, "test/steps/first-story.steps.mjs"),
      `import { Given, When, Then } from "@cucumber/cucumber";\nGiven("I am a new user", () => {});\nWhen("I do the one thing this product is for", () => {});\nThen("I see the result I came for", () => {});\n`,
    );
    writeFileSync(join(root, "nikos.settings.yaml"), JIRA + "  approvals: true\n");
    setState("FX-1", "in_progress", { dir: root });
    setState("FX-1", "done", { dir: root });
    linkTicket({ id: "FX-1", ticket: "PAY-1" }, root);
    expect(() => recordTicket({ id: "FX-1", status: "Accepted" }, root)).toThrow("Say who moved the ticket");
    expect(recordTicket({ id: "FX-1", status: "Accepted", by: "Ana Lee", on: "2026-11-06" }, root)).toMatchObject({ outcome: "approved", message: "FX-1 approved by Ana Lee in jira (PAY-1)" });
    expect(parse(readFileSync(join(root, "maps/fx/approvals/FX-1.yaml"), "utf8"))).toMatchObject({ by: "Ana Lee", on: "2026-11-06", via: "tracker" });
    expect(recordTicket({ id: "FX-1", status: "Accepted", by: "Ana Lee" }, root).outcome).toBe("in step");
    expect(ticketMoves(root)).toEqual([{ id: "FX-1", ticket: "PAY-1", nikos: "approved", status: "Accepted" }]);
  }, 60_000);
});
