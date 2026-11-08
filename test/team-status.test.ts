// The freshness rules, branch by branch (classify), and what a group keeps from a team's repo.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assign } from "../src/commands/assign";
import { teamJoin } from "../src/commands/team";
import { setState } from "../src/commands/state";
import { teamSync } from "../src/team/sync";
import { classify, type Facts } from "../src/team/status";
import { mapStatus } from "../src/commands/map-status";
import { specHash, read } from "../src/lib/project";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { groupRepo, teamRepo, write, commitAll, feature } from "./team-fixture";

const H = "aaaaaaaaaaaa";
const OLD = "bbbbbbbbbbbb";
const ok = { team: "web", repo: "acme/checkout-web", url: "x", ref: "main", ok: true, commit: "1234567", fetched: "2027-01-05", held: [] };
const base: Facts = { H, holder: "web", repo: "acme/checkout-web", copy: ok, copyGood: true };
const approval = { by: "Priya Shah", on: "2027-01-06", via: "terminal" as const, spec_hash: H, done_at: "2027-01-05T10:00:00Z", tested_commit: "1234567" };
const doneAt = { status: "done", done_at: "2027-01-05T10:00:00Z", evidence: { run_at: "t", runner: "cucumber", commit: "1234567", ok: true }, spec_hash: H };

describe("classify", () => {
  it("unassigned: nobody holds the story", () => {
    expect(classify({ H })).toEqual({ freshness: "unassigned", reason: "nobody holds it: nikos assign gives it to a team" });
  });

  it("in-place: the group holds it", () => {
    expect(classify({ H, holder: "group", repo: ".", inPlace: true })).toMatchObject({ freshness: "in-place", reason: "held by this group (--repo .)" });
  });

  it("not-fetched: the holder has no good copy, and says why a fetch failed", () => {
    const failed = { ...ok, commit: undefined, ok: false, error: "repository not found\nmore" };
    expect(classify({ ...base, copy: failed, copyGood: false })).toEqual({
      freshness: "not-fetched",
      reason: "web hasn't been fetched: run nikos map status (fetch failed: repository not found)",
    });
    expect(classify({ ...base, copy: undefined, copyGood: false }).reason).toBe("web hasn't been fetched: run nikos map status");
  });

  it("moved: the team that held it recorded the move in its status", () => {
    const prev = { repo: "acme/web-old", team: "web", known: true, copyGood: true, status: { status: "in_progress", reassigned_to: "pay" } };
    expect(classify({ ...base, holder: "pay", repo: "acme/checkout-pay", prev })).toEqual({
      freshness: "moved",
      reason: "moved to pay; web recorded the move (last in_progress)",
    });
  });

  it("moved: the team that held it hasn't committed the move", () => {
    const prev = { repo: "acme/web-old", team: "web", known: true, copyGood: true, status: { status: "in_progress" } };
    expect(classify({ ...base, holder: "pay", repo: "acme/checkout-pay", prev }).reason).toBe("moved to pay; web hasn't committed the move (last in_progress)");
  });

  it("moved: the team that held it has no status for the story", () => {
    const prev = { repo: "acme/web-old", team: "web", known: true, copyGood: true };
    expect(classify({ ...base, holder: "pay", repo: "acme/checkout-pay", prev })).toEqual({ freshness: "moved", reason: "moved to pay; web has no status for it" });
  });

  it("moved: the previous team isn't fetched, or was this group", () => {
    expect(classify({ ...base, holder: "pay", repo: "acme/checkout-pay", prev: { repo: "acme/gone", known: false, copyGood: false } }).reason).toBe(
      "moved to pay; previous team acme/gone not fetched",
    );
    expect(classify({ ...base, holder: "pay", repo: "acme/checkout-pay", prev: { repo: "." } }).reason).toBe("moved to pay; previously held by this group");
  });

  it("no-status: the holder's copy has no status for the story", () => {
    expect(classify({ ...base })).toEqual({
      freshness: "no-status",
      reason: "no status from web yet: it shows once web runs nikos sync and starts the story",
    });
  });

  it("unverified: a status with no spec hash", () => {
    expect(classify({ ...base, status: { status: "in_progress" } })).toEqual({
      freshness: "unverified",
      reason: "web set this before spec hashes: run nikos sync in web, then nikos state set <id> needs_rework, then in_progress",
    });
  });

  it("changed: a done story proved against an older feature", () => {
    expect(classify({ ...base, status: { status: "done", spec_hash: OLD } })).toEqual({
      freshness: "changed",
      reason: "proved against an older feature: web runs nikos sync, then nikos state set <id> needs_rework, then in_progress, then done",
    });
  });

  it("behind: work in progress written against an older feature", () => {
    expect(classify({ ...base, status: { status: "in_progress", spec_hash: OLD } })).toEqual({
      freshness: "behind",
      reason: "web's copy is behind the feature: run nikos sync in web, then nikos state set <id> needs_rework, then in_progress",
    });
  });

  it("current: work in progress against the current feature", () => {
    expect(classify({ ...base, status: { status: "in_progress", spec_hash: H } })).toEqual({ freshness: "current", reason: "" });
  });

  it("current, not approved: done with no delivery approval, where approval is required", () => {
    expect(classify({ ...base, status: { ...doneAt }, policy: "required-for-release" })).toEqual({ freshness: "current", reason: "done, not approved" });
  });

  it("current, optional: under the default policy a done story counts without an approval", () => {
    expect(classify({ ...base, status: { ...doneAt } })).toEqual({ freshness: "current", reason: "done (approval optional here)", optional: true });
    expect(classify({ ...base, status: { ...doneAt }, policy: "optional" })).toMatchObject({ optional: true });
  });

  it("current, approved: done with a delivery approval that holds", () => {
    expect(classify({ ...base, status: { ...doneAt, updated: "2027-01-05" }, approval: { ...approval, tested_commit: "1234567" } as any })).toEqual({
      freshness: "current",
      reason: "done, approved by Priya Shah 2027-01-06",
      approved: true,
      approvedBy: "Priya Shah",
    });
  });

  it("current, lapsed: the approval named an older feature than the story's current one", () => {
    const r = classify({ ...base, status: { ...doneAt }, approval: { ...approval, spec_hash: OLD } as any });
    expect(r.reason).toBe("done, approval lapsed: its feature changed since");
    expect(r.approved).toBeUndefined();
    expect(r.lapse).toBe("its feature changed since");
  });

  it("current, approved: with approval.policy off, a done story counts without one", () => {
    expect(classify({ ...base, status: { ...doneAt }, policy: "off" })).toMatchObject({ freshness: "current", approved: true });
  });
});

describe("what a group keeps from a team's repo", () => {
  it("keeps only status, approvals and the team file, and a state set stamps the spec hash it was written against", () => {
    const g = groupRepo("PAY");
    assign(g, "web", { repo: "acme/checkout-web", releases: [1] });
    commitAll(g, "assign");
    const t = teamRepo();
    teamJoin(t, "acme/pay/checkout-group", { url: g });
    commitAll(t, "join");
    setState("PAY-CHK-1", "in_progress", { dir: t });
    commitAll(t, "start");
    const copy = join(t, ".nikos/assigned/acme/pay/checkout-group/maps/chk/features/pay/pay-by-card.feature");
    expect(parse(readFileSync(join(t, "status/PAY-CHK-1.yaml"), "utf8")).spec_hash).toBe(specHash(read(copy)));

    // The group changes the feature; the team's copy is stale until it syncs, and the stamp shows it.
    write(join(g, "maps/chk/features/pay/pay-by-card.feature"), feature("PAY-CHK-1", "pay", 1, "Pay by card, with a receipt"));
    commitAll(g, "edit feature");
    teamSync(t);
    expect(parse(readFileSync(join(t, "status/PAY-CHK-1.yaml"), "utf8")).spec_hash).not.toBe(specHash(read(copy)));
  });

  it("a team's code is not kept in the group's copy: only status, approvals and the team file", () => {
    const g = groupRepo("PAY");
    const web = teamRepo();
    assign(g, "web", { repo: "acme/checkout-web", releases: [1], url: web });
    commitAll(g, "assign");
    teamJoin(web, "acme/pay/checkout-group", { url: g });
    commitAll(web, "join");
    setState("PAY-CHK-1", "in_progress", { dir: web });
    commitAll(web, "start");
    mapStatus(g);
    const copy = join(g, ".nikos/teams/acme/checkout-web");
    expect(existsSync(join(copy, "status/PAY-CHK-1.yaml"))).toBe(true);
    expect(existsSync(join(copy, "package.json"))).toBe(false);
    expect(existsSync(join(copy, ".git"))).toBe(false);
  });
});
