import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { assign } from "../src/commands/assign";
import { teamJoin } from "../src/commands/team";
import { teamSync } from "../src/team/sync";
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
import { groupRepo, git, teamRepo, write, commitAll, feature } from "./team-fixture";

// The runner is a stand-in here: each test says whether the scenarios pass.
vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
const runner = vi.mocked(verify);
beforeEach(() => runner.mockClear());

const status = (t: string, id: string) => parse(readFileSync(join(t, "status", `${id}.yaml`), "utf8"));

/** A group with its map assigned to one team (release 1 only), joined and synced, and committed. */
function setup(key = "PAY") {
  const g = groupRepo(key);
  assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
  commitAll(g, "assign");
  const t = teamRepo();
  teamJoin(t, `acme/${key.toLowerCase()}/checkout-group`, { url: g });
  commitAll(t, "join");
  return { g, t };
}

describe("a team's flow on its assigned stories", () => {
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
    const text = readFileSync(join(t, ".nikos/assigned/acme/pay/checkout-group/maps/chk/features/pay/pay-by-card.feature"), "utf8");
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
      `PAY-CHK-1 was tested at ${head.slice(0, 7)}, and the code has changed since (HEAD is ${git(t, "rev-parse", "--short", "HEAD")}): run its scenarios again with nikos state set PAY-CHK-1 needs_rework, then done`,
    );
  });

  it("only a done story can be approved", () => {
    const { t } = setup();
    expect(() => approve("PAY-CHK-1", { dir: t, by: "Priya Shah" })).toThrow("PAY-CHK-1 is todo: only a done story can be approved");
  });

  it("a feature edit in the group lapses the approval once the team re-syncs", () => {
    const { g, t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t });
    commitAll(t, "code");
    setState("PAY-CHK-1", "done", { dir: t });
    commitAll(t, "done");
    approve("PAY-CHK-1", { dir: t, by: "Priya Shah" });
    expect(validate(t).errors).toEqual([]);

    write(join(g, "maps/chk/features/pay/pay-by-card.feature"), feature("PAY-CHK-1", "pay", 1, "Pay by card, with a receipt"));
    commitAll(g, "edit feature");
    teamSync(t);
    const v = validate(t);
    expect(v.errors.map((e) => e.message)).toEqual([expect.stringContaining("approval is for spec")]);
    expect(show("PAY-CHK-1", t)).toContain("no longer holds");
  });

  it("the copies of two groups with the same map key keep their stories apart", () => {
    const pay = groupRepo("PAY");
    const acme = groupRepo("ACME");
    assign(pay, "Checkout web", { repo: "acme/checkout-web" });
    assign(acme, "Checkout web", { repo: "acme/checkout-web" });
    commitAll(pay, "assign");
    commitAll(acme, "assign");
    const t = teamRepo();
    teamJoin(t, "acme/payments/checkout-group", { url: pay });
    teamJoin(t, "acme/acme/checkout-group", { url: acme });
    commitAll(t, "join");
    teamSync(t);

    expect(() => next(t)).toThrow("several assigned maps (ACME-CHK, PAY-CHK): pass --map GROUP-MAP");
    expect(next(t, "ACME-CHK").story).toBe("ACME-CHK-1");

    expect(show("PAY-CHK-1", t)).toContain("PAY-CHK-1 — Pay by card");
    expect(show("ACME-CHK-1", t)).toContain("ACME-CHK-1 — Pay by card");
    linkTicket({ id: "ACME-CHK-1", ticket: "ENG-7" }, t);
    expect(status(t, "ACME-CHK-1")).toMatchObject({ status: "todo", ticket: "ENG-7" });
    expect(existsSync(join(t, "status/PAY-CHK-1.yaml"))).toBe(false);
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
    const { g, t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t });
    commitAll(t, "code");
    setState("PAY-CHK-1", "done", { dir: t });
    commitAll(t, "done");
    approve("PAY-CHK-1", { dir: t, by: "Priya Shah" });
    commitAll(t, "approve");
    write(join(g, "maps/chk/features/pay/pay-by-card.feature"), feature("PAY-CHK-1", "pay", 1, "Pay by card, with a receipt"));
    commitAll(g, "edit feature");
    teamSync(t);
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

  it("a story the team no longer has is refused by show and state set, with the team it went to", () => {
    const { g, t } = setup();
    setState("PAY-CHK-1", "in_progress", { dir: t });
    commitAll(t, "start");
    assign(g, "Checkout api", { repo: "acme/checkout-api", stories: ["PAY-CHK-1"] });
    commitAll(g, "move");
    teamSync(t);
    expect(() => show("PAY-CHK-1", t)).toThrow("PAY-CHK-1 was reassigned to Checkout api");
    expect(() => setState("PAY-CHK-1", "needs_rework", { dir: t })).toThrow("PAY-CHK-1 was reassigned to Checkout api");
    expect(next(t).story).toBe("PAY-CHK-2");
  });

  it("next doesn't wait on a dependency another team holds, and says so", () => {
    const { g, t } = setup();
    write(join(g, "maps/chk/features/pay/pay-by-card.feature"), feature("PAY-CHK-1", "pay", 1, "Pay by card").replace("@PAY-CHK-1 ", "@PAY-CHK-1 @depends-PAY-CHK-3 "));
    commitAll(g, "depends");
    teamSync(t);
    const r = next(t);
    expect(r.story).toBe("PAY-CHK-1");
    expect(r.unchecked).toEqual(["PAY-CHK-3"]);
    expect(validate(t).warnings.map((w) => w.message)).toContain("PAY-CHK-1 depends on PAY-CHK-3, which isn't in this team's assigned stories");
  });

  it("stories, steps, activities, releases and tracker imports are refused in a team repo", () => {
    const { t } = setup();
    const refused = "this is a team repo: stories are added in the group repo";
    expect(() => newStory({ title: "Refund", activity: "pay" }, t)).toThrow(refused);
    expect(() => newActivity({ title: "Refunds" }, t)).toThrow(refused);
    expect(() => newStep({ title: "Ask", activity: "pay" }, t)).toThrow(refused);
    expect(() => addRelease({ title: "Three" }, t)).toThrow(refused);
    expect(() => importTickets([{ key: "ENG-1", title: "Refund" }], t)).toThrow(refused);
    expect(existsSync(join(t, ".nikos/assigned/acme/payments/checkout-group/maps/chk/features/refund"))).toBe(false);
  });

  it("the tracker writes a team's ticket links and cancellations into its own status, and leaves the group's map alone", () => {
    const { g, t } = setup();
    write(join(t, "nikos.settings.yaml"), "format_version: 1\ntracker:\n  system: jira\n  site: acme.atlassian.net\n  project: PAY\n  statuses:\n    In Progress: in_progress\n    Won't Do: cancelled\n");
    const groupMap = readFileSync(join(g, "maps/chk/state.yaml"), "utf8");
    linkTicket({ id: "PAY-CHK-1", ticket: "PAY-101" }, t);
    setState("PAY-CHK-1", "in_progress", { dir: t });
    expect(ticketMoves(t)).toEqual([expect.objectContaining({ id: "PAY-CHK-1", ticket: "PAY-101", status: "In Progress" })]);
    recordTicket({ id: "PAY-CHK-1", status: "Won't Do", by: "Ana Lee" }, t);
    expect(status(t, "PAY-CHK-1")).toMatchObject({ status: "cancelled", ticket: "PAY-101" });
    expect(readFileSync(join(g, "maps/chk/state.yaml"), "utf8")).toBe(groupMap);
  });
});

