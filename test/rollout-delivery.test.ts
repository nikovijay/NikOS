import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companyInit } from "../src/commands/start";
import { formatRollout, rollout } from "../src/planning/rollout";
import { writeDeliverySummary, type DeliverySummary } from "../src/lib/delivery-summary";
import { groupRepo, git, write, commitAll } from "./team-fixture";
import { assign } from "../src/commands/assign";

const NOW = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** A company plan whose department-level group (acme/payments-group) has a map with a summary, and a second map with its own state. */
function setup(summary: DeliverySummary["stories"]) {
  const co = mkdtempSync(join(tmpdir(), "nikos-co-"));
  git(co, "init", "-q", "-b", "main");
  git(co, "remote", "add", "origin", "https://github.com/acme/company-plan.git");
  companyInit(co, { name: "Acme", period: "Q1 2027", repo: "acme/company-plan" });
  commitAll(co, "plan");

  const grp = groupRepo("PAY");
  git(grp, "remote", "add", "origin", "https://github.com/acme/payments-group.git");
  write(join(grp, "maps/hr/storymap.yaml"), "format_version: 1\nproject: hr\nkey: HR\nbet: faster-checkout\nactivities: []\nreleases:\n  - number: 1\n    title: First\n    stories: [PAY-HR-1]\n");
  write(join(grp, "maps/hr/state.yaml"), "format_version: 1\nstories:\n  PAY-HR-1: { status: done }\n");
  writeDeliverySummary(join(grp, "maps/chk"), { format_version: 1, map: "chk", owner: "acme/payments-group", read_at: NOW, stories: summary });
  commitAll(grp, "map and summary");

  write(join(co, "planning/downstream.yaml"), `- name: Payments\n  repo: acme/payments-group\n  url: ${grp}\n`);
  commitAll(co, "downstream");
  return { co, grp };
}

const story = (id: string, status: string, approval: "none" | "approved" = "none") => ({
  id,
  team: "acme/checkout-web",
  status,
  approval,
  ...(approval === "approved" ? { approved_by: "Ana Example" } : {}),
  read_at: NOW,
});

describe("a rollout's delivery from the owner's summaries", () => {
  it("sums every map the group holds, so a group with two maps no longer reads 0 of 0", () => {
    const { co } = setup([story("PAY-CHK-1", "done", "approved"), story("PAY-CHK-2", "in_progress"), story("PAY-CHK-3", "todo")]);
    const payments = rollout(co).plans.find((p) => p.name === "Payments")!;
    expect(payments.delivery).toMatchObject({ stories: 4, done: 2, approved: 1, inProgress: 1 });
    expect(payments.delivery?.noSummary).toBeUndefined();
    const text = formatRollout(rollout(co));
    expect(text).not.toMatch(/0 of 0/);
    expect(text).toMatch(/delivery: 2 of 4 stories done \(1 approved\), 1 in progress, read today \(\d{4}-\d{2}-\d{2}\)/);
  });

  it("a story the summary doesn't list says it has no summary yet, and counts as not done", () => {
    const { co } = setup([story("PAY-CHK-1", "done", "approved"), story("PAY-CHK-2", "in_progress")]);
    const payments = rollout(co).plans.find((p) => p.name === "Payments")!;
    expect(payments.delivery).toMatchObject({ stories: 4, done: 2, noSummary: 1 });
    expect(formatRollout(rollout(co))).toMatch(/1 story has no summary yet: run nikos map status in acme\/payments-group/);
  });

  it("a bet counts the owner's summary for its stories, and says what has no summary yet", () => {
    const { co } = setup([story("PAY-CHK-1", "done", "approved"), story("PAY-CHK-2", "in_progress")]);
    const bet = rollout(co).plans.find((p) => p.name === "Payments")!.bets.find((b) => b.id === "faster-checkout")!;
    // The bet aims at both maps: chk's three stories (the summary lists two) and hr's one, which has no team and counts its own state.
    // The bet's line also says how old the summary it counts is, as the plan line does (the amendment, rule 9).
    expect(bet.delivery).toMatch(/Building, 2 of 4 done, read today \(\d{4}-\d{2}-\d{2}\); 1 with no summary yet: run nikos map status in acme\/payments-group/);
  });

  it("a rollout never reads a team's live status/: a team's own map shows no next story and no blocker from it", () => {
    const { co, grp } = setup([story("PAY-CHK-1", "done", "approved")]);
    // A team that owns a map (WEB-INB) with its own status at its root: in progress, and blocked.
    const team = mkdtempSync(join(tmpdir(), "nikos-team-live-"));
    git(team, "init", "-q", "-b", "main");
    write(join(team, "nikos.team.yaml"), "format_version: 2\nname: Web team\nrepo: acme/web-team\nkey: WEB\nhome: acme/payments-group\ngroups: []\nmembers: []\n");
    write(join(team, "maps/inb/storymap.yaml"), "format_version: 1\nproject: inb\nkey: INB\nbet: faster-checkout\nactivities: []\nreleases:\n  - number: 1\n    title: First\n    stories: [WEB-INB-1, WEB-INB-2]\n");
    write(join(team, "status/WEB-INB-1.yaml"), "status: in_progress\nblockers: [waiting on design]\n");
    write(join(team, "status/WEB-INB-2.yaml"), "status: todo\n");
    commitAll(team, "team");
    write(join(co, "planning/downstream.yaml"), `- name: Payments\n  repo: acme/payments-group\n  url: ${grp}\n- name: Web team\n  repo: acme/web-team\n  url: ${team}\n`);
    commitAll(co, "downstream with team");
    const teamPlan = rollout(co).plans.find((p) => p.repo === "acme/web-team")!;
    expect(teamPlan.next).toBeUndefined();
    expect(teamPlan.blockers).toEqual([]);
    expect(formatRollout(rollout(co))).not.toMatch(/waiting on design|next: WEB-INB/);
  });

  it("a team that was never fetched changes nothing above, and nothing is fetched for it", () => {
    const { co, grp } = setup([story("PAY-CHK-1", "done", "approved"), story("PAY-CHK-2", "in_progress"), story("PAY-CHK-3", "todo")]);
    // The group assigns chk to a team whose repo was never created: the owner's summary still says the delivery.
    assign(grp, "Checkout web", { repo: "acme/no-such-team", releases: [1], map: "chk" });
    commitAll(grp, "assign");
    const r = rollout(co);
    const payments = r.plans.find((p) => p.name === "Payments")!;
    expect(payments.delivery).toMatchObject({ stories: 4, done: 2, approved: 1, inProgress: 1 });
    expect(JSON.stringify(r)).not.toMatch(/no-such-team/);
  });
});
