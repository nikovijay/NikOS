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
import { git, groupRepo, teamOwnsGroupMap, teamRepo, write, commitAll, feature } from "./team-fixture";

// The runner is a stand-in here: each test says whether the scenarios pass.
vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
const runner = vi.mocked(verify);
beforeEach(() => runner.mockClear());

const status = (t: string, id: string) => parse(readFileSync(join(t, "status", `${id}.yaml`), "utf8"));

/** A group's map, owned by one team (its own copy, with the group\'s ids), committed. */
function setup(key = "PAY") {
  const g = groupRepo(key);
  const t = teamRepo();
  teamOwnsGroupMap(t, g);
  return { g, t };
}

describe("a team's flow on its own map", () => {
  it("next lists only the team's stories, in release order", () => {
    const { t } = setup();
    expect(next(t).story).toBe("PAY-CHK-1");
    expect(next(t).waiting).toEqual([]);
  });

  it("state set in-progress writes status/, never intent/", () => {
    const { t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t, by: "Priya" });
    expect(status(t, "PAY-CHK-1")).toMatchObject({ status: "in_progress", claimed_by: "Priya" });
    expect(readFileSync(join(t, "status/PAY-CHK-1.yaml"), "utf8")).toMatch(/^status: in_progress$/m);
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
    expect(parse(readFileSync(join(t, "approvals/PAY-CHK-1.yaml"), "utf8"))).toEqual({
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



  it("a team repo with intent/ is refused by next, state and validate", () => {
    const { t } = setup();
    write(join(t, "intent/storymap.yaml"), "key: HT\nactivities: []\nreleases: []\n");
    const message = "this repo has intent/ or maps/ and nikos.team.yaml: keep one";
    expect(() => next(t)).toThrow(message);
    expect(() => setState("PAY-CHK-1", "in_progress", { dir: t })).toThrow(message);
    expect(validate(t).errors.map((e) => e.message)).toContain("this repo has intent/ or maps/ and nikos.team.yaml: keep one");
  });
});

describe("a team's flow: the review's edge cases", () => {
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
      expect(out.mock.calls.flat().join("\n")).toContain("approval is for spec");
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
    write(join(t, "status/PAY-CHK-1.yaml"), "status: done\nupdated: 2027-01-05\n");
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



  it("stories, steps, activities and releases are refused in a team repo that has no map of its own", () => {
    const t = teamRepo();
    const refused = "this is a team repo: stories are added in the group repo";
    expect(() => newStory({ title: "Refund", activity: "pay" }, t)).toThrow(refused);
    expect(() => newActivity({ title: "Refunds" }, t)).toThrow(refused);
    expect(() => newStep({ title: "Ask", activity: "pay" }, t)).toThrow(refused);
    expect(() => addRelease({ title: "Three" }, t)).toThrow(refused);
    expect(existsSync(join(t, "maps"))).toBe(false);
  });

  it("the tracker writes a team's ticket links and cancellations into its own status, and leaves the group's map alone", () => {
    const { t } = setup();
    write(join(t, "nikos.settings.yaml"), "format_version: 1\ntracker:\n  system: jira\n  site: acme.atlassian.net\n  project: PAY\n  statuses:\n    In Progress: in_progress\n    Won't Do: cancelled\n");
    const groupMap = readFileSync(join(t, "maps/chk/state.yaml"), "utf8");
    linkTicket({ id: "PAY-CHK-1", ticket: "PAY-101" }, t);
    setState("PAY-CHK-1", "in_progress", { dir: t });
    expect(ticketMoves(t)).toEqual([expect.objectContaining({ id: "PAY-CHK-1", ticket: "PAY-101", status: "In Progress" })]);
    recordTicket({ id: "PAY-CHK-1", status: "Won't Do", by: "Ana Lee" }, t);
    expect(status(t, "PAY-CHK-1")).toMatchObject({ status: "cancelled", ticket: "PAY-101" });
    expect(readFileSync(join(t, "maps/chk/state.yaml"), "utf8")).toBe(groupMap);
  });
});

