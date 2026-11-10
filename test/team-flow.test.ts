import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { next } from "../src/commands/next";
import { runState, setState } from "../src/commands/state";
import { approve } from "../src/commands/approve";
import { show } from "../src/commands/show";
import { importTickets, linkTicket, recordTicket, ticketMoves } from "../src/commands/tracker";
import { newStory } from "../src/commands/story";
import { newActivity, newStep } from "../src/commands/step";
import { addRelease } from "../src/commands/release";
import { validate } from "../src/commands/validate";
import { verify } from "../src/commands/verify";
import { specHash } from "../src/lib/project";
import { git, groupRepo, write, commitAll, feature } from "./repo-fixture";

// The runner is a stand-in here: each test says whether the scenarios pass.
vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
const runner = vi.mocked(verify);
beforeEach(() => runner.mockClear());

/** A story's state in its map, maps/chk/state.yaml: a team's state lives in its own map. */
const status = (t: string, id: string) => parse(readFileSync(join(t, "maps/chk/state.yaml"), "utf8")).stories[id];

/** A group repo with its one map, committed. The repo is both the group and the place its map is worked on. */
function setup(key = "PAY") {
  const g = groupRepo(key);
  return { g, t: g };
}

describe("a repo's flow on its own map", () => {
  it("next lists only the team's stories, in release order", () => {
    const { t } = setup();
    expect(next(t).story).toBe("PAY-CHK-1");
    expect(next(t).waiting).toEqual([]);
  });

  it("state set in-progress writes the map's state.yaml, never intent/", () => {
    const { t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t, by: "Priya" });
    expect(status(t, "PAY-CHK-1")).toMatchObject({ status: "in_progress", claimed_by: "Priya" });
    expect(existsSync(join(t, "status"))).toBe(false);
    expect(existsSync(join(t, "intent"))).toBe(false);
  });

  it("done writes the spec hash, the tested commit and the evidence", () => {
    const { t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t });
    commitAll(t, "code");
    const head = git(t, "rev-parse", "HEAD");
    setState("PAY-CHK-1", "done", { dir: t, now: "2027-01-05T10:00:00Z", date: "2027-01-05" });
    const text = readFileSync(join(t, "maps/chk/features/pay/pay-by-card.feature"), "utf8");
    const s = status(t, "PAY-CHK-1");
    expect(s).toMatchObject({ status: "done", spec_hash: specHash(text), tested_commit: head, done_at: "2027-01-05T10:00:00Z" });
    expect(s.evidence).toMatchObject({ runner: "cucumber", commit: head, ok: true, run_at: "2027-01-05T10:00:00Z" });
  });

  it("refuses done when the scenarios fail, and the story stays where it was", () => {
    const { t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t });
    runner.mockReturnValueOnce({ stack: "js", command: "cucumber-js", status: 1, output: "1) Scenario: AC1 — Paying shows a receipt # x.feature:5\n" });
    expect(() => setState("PAY-CHK-1", "done", { dir: t })).toThrow("PAY-CHK-1 stays in_progress: its scenarios don't all pass");
    expect(status(t, "PAY-CHK-1").status).toBe("in_progress");
  });

  it("approve writes approvals/<id>.yaml with the tested commit, and the approval survives committing the status", () => {
    const { t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t });
    commitAll(t, "code");
    const head = git(t, "rev-parse", "HEAD");
    setState("PAY-CHK-1", "done", { dir: t, now: "2027-01-05T10:00:00Z" });
    commitAll(t, "status done"); // HEAD moves, but no code changed since the tested commit
    approve("PAY-CHK-1", { dir: t, by: "Priya Shah", date: "2027-01-06" });
    expect(parse(readFileSync(join(t, "maps/chk/approvals/PAY-CHK-1.yaml"), "utf8"))).toEqual({
      by: "Priya Shah",
      on: "2027-01-06",
      via: "terminal",
      spec_hash: status(t, "PAY-CHK-1").spec_hash,
      done_at: "2027-01-05T10:00:00Z",
      tested_commit: head,
    });
    expect(validate(t).errors).toEqual([]);
  });

  it("approve is refused once code has changed since the tested commit, and says what to do", () => {
    const { t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t });
    commitAll(t, "code");
    const head = git(t, "rev-parse", "HEAD");
    setState("PAY-CHK-1", "done", { dir: t });
    write(join(t, "src/checkout.js"), "export const pay = () => {};\n");
    commitAll(t, "more code");
    expect(() => approve("PAY-CHK-1", { dir: t, by: "Priya Shah" })).toThrow(
      `PAY-CHK-1 was tested at ${head.slice(0, 7)}, and the code has changed since (HEAD is ${git(t, "rev-parse", "--short", "HEAD")}): run its scenarios again: nikos state set PAY-CHK-1 needs_rework, then in_progress, then done, then approve`,
    );
  });

  it("only a done story can be approved", () => {
    const { t } = setup();
    expect(() => approve("PAY-CHK-1", { dir: t, by: "Priya Shah" })).toThrow("PAY-CHK-1 is todo: only a done story can be approved");
  });
});

describe("a repo's flow: the review's edge cases", () => {
  it("a delivery approval that lapses while state set moves a story is a warning, and the move exits 0", () => {
    const { t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t });
    commitAll(t, "code");
    setState("PAY-CHK-1", "done", { dir: t });
    commitAll(t, "done");
    approve("PAY-CHK-1", { dir: t, by: "Priya Shah" });
    commitAll(t, "approve");
    write(join(t, "maps/chk/features/pay/pay-by-card.feature"), feature("PAY-CHK-1", "pay", 1, "Pay by card, with a receipt"));
    commitAll(t, "edit feature");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(runState(["set", "PAY-CHK-1", "needs_rework", "--dir", t])).toBe(0);
      expect(out.mock.calls.flat().join("\n")).toContain("approval no longer holds: it's needs_rework now");
      expect(err).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    expect(status(t, "PAY-CHK-1").status).toBe("needs_rework");
  });

  it("done on a dirty tree says so, and approve refuses the uncommitted code", () => {
    const { t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t });
    commitAll(t, "code");
    write(join(t, "src/checkout.js"), "// not committed yet\n");
    expect(setState("PAY-CHK-1", "done", { dir: t }).dirty).toBe(true);
    expect(() => approve("PAY-CHK-1", { dir: t, by: "Priya Shah" })).toThrow("the code has uncommitted changes");
  });

  it("approve refuses a done story whose status has no evidence of a commit", () => {
    const { t } = setup();
    write(join(t, "maps/chk/state.yaml"), "format_version: 1\nstories:\n  PAY-CHK-1: { status: done, updated: 2027-01-05 }\n  PAY-CHK-2: { status: todo }\n  PAY-CHK-3: { status: todo }\n");
    commitAll(t, "status");
    expect(() => approve("PAY-CHK-1", { dir: t, by: "Priya Shah" })).toThrow("was tested at no commit");
  });

  it("show and validate say when the code has changed since an approval was tested", () => {
    const { t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t });
    commitAll(t, "code");
    setState("PAY-CHK-1", "done", { dir: t });
    commitAll(t, "done");
    approve("PAY-CHK-1", { dir: t, by: "Priya Shah" });
    commitAll(t, "approve");
    expect(show("PAY-CHK-1", t)).not.toContain("has changed since it was tested");
    write(join(t, "src/checkout.js"), "// changed\n");
    commitAll(t, "code, after approval");
    expect(show("PAY-CHK-1", t)).toContain("The code has changed since it was tested");
    expect(validate(t).warnings.map((w) => w.message).join("\n")).toContain("has changed since it was tested");
  });



  it("the tracker writes a map's ticket links and cancellations into its map's state", () => {
    const { t } = setup();
    write(join(t, "nikos.settings.yaml"), "format_version: 1\ntracker:\n  system: jira\n  site: acme.atlassian.net\n  project: PAY\n  statuses:\n    In Progress: in_progress\n    Won't Do: cancelled\n");
    linkTicket({ id: "PAY-CHK-1", ticket: "PAY-101" }, t);
    setState("PAY-CHK-1", "in_progress", { dir: t });
    expect(ticketMoves(t)).toEqual([expect.objectContaining({ id: "PAY-CHK-1", ticket: "PAY-101", status: "In Progress" })]);
    recordTicket({ id: "PAY-CHK-1", status: "Won't Do", by: "Ana Lee" }, t);
    expect(status(t, "PAY-CHK-1")).toMatchObject({ status: "cancelled", ticket: "PAY-101" });
  });
});

