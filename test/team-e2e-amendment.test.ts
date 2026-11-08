// The amendment end to end (teams that own a story map, after 0.3.0), with real git repos and local
// remotes: a company plan with a key result and a bet; a department joined to it; a group homed in the
// department; team A (WEB) homed in the group, owning a map for the company bet and its own bet aimed at
// the company key result; team B (IOS) homed in the group, given stories from the group's map and from
// team A's map. Both teams prove a story, approve it, and the map status of the group and of team A is
// written to delivery.yaml. The company rollout then shows both maps' delivery, with no double-printed bets.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { addDownstream, formatRollout, rollout } from "../src/planning/rollout";
import { assign } from "../src/commands/assign";
import { joinPlan } from "../src/commands/join";
import { teamInit, teamJoin } from "../src/commands/team";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { setState } from "../src/commands/state";
import { approve } from "../src/commands/approve";
import { mapStatus, writeSummaries } from "../src/commands/map-status";
import { validate } from "../src/commands/validate";
import { readDeliverySummary } from "../src/lib/delivery-summary";
import { newBet } from "../src/planning/bets";
import { status as planningStatus } from "../src/planning/cli";
import { verify } from "../src/commands/verify";
import { companyRepo, departmentRepo } from "./planning-fixture";
import { commitAll, git, groupRepo, write } from "./team-fixture";

vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
beforeEach(() => vi.mocked(verify).mockClear());

const BET = (id: string, primary?: string) =>
  `---\nid: ${id}\nowner: Product\nhypothesis: Faster inbox keeps people paying.\nkrs:\n  ${primary ? `primary: ${primary}\n  ` : ""}also: []\nreview_on: 2027-03-31\nconfidence: medium\ndependencies: []\noutcome: open\nreviews: []\n---\n\n## Why we think so\nTesters said checkout is slow.\n`;

/** A team repo with its key, an origin (so its delivery summary names it) and nothing joined yet. */
function team(key: string, repo: string, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `nikos-e2e-${key.toLowerCase()}-`));
  write(join(dir, "package.json"), `{"name":"${key.toLowerCase()}","private":true}\n`);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", `https://github.com/${repo}.git`);
  teamInit(dir, { repo, name, key });
  write(join(dir, "nikos.team.yaml"), `format_version: 2\nname: ${name}\nrepo: ${repo}\nkey: ${key}\ngroups: []\nmembers: []\n`);
  commitAll(dir, "team");
  return dir;
}

const status = (dir: string, id: string) => parse(readFileSync(join(dir, "status", `${id}.yaml`), "utf8"));

describe("the amendment, end to end", () => {
  it("company, department, group and two teams: maps, sources, delivery, and the company rollout", () => {
    // The company plan: kr-1 and a bet aimed at it. Its origin is acme/company-plan.
    const company = companyRepo();
    newBet({ id: "one-inbox", owner: "Board", hypothesis: "One inbox keeps people paying.", reviewOn: "2027-03-31", primary: "kr-1" }, company);
    commitAll(company, "company bet");

    // The department joins the company, and the group joins the department as its home.
    const dept = departmentRepo(company);
    const group = groupRepo("PAY");
    git(group, "remote", "add", "origin", "https://github.com/acme/payments-group.git");
    write(join(group, "planning/bets/faster-checkout.md"), BET("faster-checkout"));
    commitAll(group, "bet card");
    joinPlan(group, { repo: "acme/payments-plan", url: dept, home: true });
    commitAll(group, "join the department");
    addDownstream(dept, { name: "Payments group", repo: "acme/payments-group", url: group });
    commitAll(dept, "the group below");
    addDownstream(company, { name: "Payments", repo: "acme/payments-plan", url: dept });
    commitAll(company, "the department below");

    // Team A (WEB): homed in the group, joins the company too, and owns maps/inb for the company bet.
    const a = team("WEB", "acme/web-team", "Web team");
    joinPlan(a, { repo: "acme/payments-group", url: group, home: true });
    joinPlan(a, { repo: "acme/company-plan", url: company });
    write(join(a, "planning/bets/inbox-speed.md"), BET("inbox-speed", "acme/company-plan#kr-1"));
    commitAll(a, "its own bet");
    newMap({ bet: "acme/company-plan#one-inbox", key: "INB" }, a);
    newStory({ title: "Pay by card", activity: "getting-started" }, a);
    newStory({ title: "Pay by wallet", activity: "getting-started" }, a);
    commitAll(a, "map");

    // Team B (IOS): homed in the group, and takes stories from the group's map and from team A's map.
    const b = team("IOS", "acme/ios-team", "iOS team");
    joinPlan(b, { repo: "acme/payments-group", url: group, home: true });
    assign(group, "iOS team", { repo: "acme/ios-team", stories: ["PAY-CHK-1"], url: b });
    commitAll(group, "assign the group's story");
    assign(a, "Web team", { repo: ".", stories: ["WEB-INB-1"] });
    assign(a, "iOS team", { repo: "acme/ios-team", stories: ["WEB-INB-2"], url: b });
    commitAll(a, "assign");
    teamJoin(b, "acme/payments-group", { url: group });
    teamJoin(b, "acme/web-team", { url: a });
    commitAll(b, "takes stories from the group and from team A");

    // Each team proves its story and an approval is given: team B's copies hold both stories.
    expect(existsSync(join(b, ".nikos/assigned/acme/payments-group/maps/chk/features"))).toBe(true);
    expect(existsSync(join(b, ".nikos/assigned/acme/web-team/maps/inb/features"))).toBe(true);
    setState("PAY-CHK-1", "in_progress", { dir: b, by: "Priya" });
    setState("PAY-CHK-1", "done", { dir: b, by: "Priya" });
    approve("PAY-CHK-1", { dir: b, by: "Priya Shah", date: "2027-01-06" });
    setState("WEB-INB-2", "in_progress", { dir: b, by: "Priya" });
    setState("WEB-INB-2", "done", { dir: b, by: "Priya" });
    approve("WEB-INB-2", { dir: b, by: "Priya Shah", date: "2027-01-06" });
    commitAll(b, "delivered");
    expect(status(b, "PAY-CHK-1")).toMatchObject({ status: "done" });
    expect(status(b, "WEB-INB-2")).toMatchObject({ status: "done" });

    // The group lists both teams below it. Its map status reads team B, and writes the group's delivery.yaml;
    // team A's reads its own story in place and team B's, and writes its delivery.yaml. Both are committed, so the plans above see them.
    addDownstream(group, { name: "Web team", repo: "acme/web-team", url: a });
    addDownstream(group, { name: "iOS team", repo: "acme/ios-team", url: b });
    const g = mapStatus(group);
    expect(g[0].stories.find((s) => s.id === "PAY-CHK-1")).toMatchObject({ team: "iOS team", freshness: "current", delivery: "approved by Priya Shah" });
    writeSummaries(group, g);
    commitAll(group, "delivery");
    expect(readDeliverySummary(join(group, "maps/chk"))?.stories.find((s) => s.id === "PAY-CHK-1")).toMatchObject({ team: "acme/ios-team", status: "done", approval: "approved" });

    const ta = mapStatus(a);
    expect(ta[0].stories.find((s) => s.id === "WEB-INB-1")).toMatchObject({ holder: ".", freshness: "in-place" });
    expect(ta[0].stories.find((s) => s.id === "WEB-INB-2")).toMatchObject({ team: "iOS team", freshness: "current" });
    writeSummaries(a, ta);
    commitAll(a, "delivery");
    expect(existsSync(join(a, "maps/inb/delivery.yaml"))).toBe(true);

    // The company rollout, through the department and the group, to both teams: each map's delivery counts.
    const r = rollout(company);
    const byName = (name: string) => r.plans.find((p) => p.name === name)!;
    expect(byName("Web team").delivery).toMatchObject({ stories: 2, done: 1, approved: 1 });
    expect(byName("Payments group").delivery).toMatchObject({ stories: 3, done: 1 });
    expect(byName("iOS team").state).toBe("joined");
    expect(r.problems).toEqual([]);
    const text = formatRollout(r);
    expect(text).toContain("delivery: 1 of 2 stories done (1 approved), 0 in progress");
    expect(text).toContain("delivery: 1 of 3 stories done");
    // A bet is printed once in the alignment tree and once on its plan's line, and nowhere else.
    expect(text.split("bet inbox-speed (").length - 1).toBe(1);
    expect(text.split("\n    bet inbox-speed:").length - 1).toBe(1);
    expect(text.split("bet faster-checkout (").length - 1).toBe(1);
    expect(text.split("\n    bet faster-checkout:").length - 1).toBe(1);

    // Team A's map is for the company's bet: it shows under that bet in the tree, on team A's line, and in the company's status.
    expect(byName("Web team").maps).toEqual([{ map: "inb", bet: "acme/company-plan#one-inbox", stories: 2, done: 1, approved: 1, inProgress: 0, asOf: expect.any(String) }]);
    expect(text).toContain("    map inb → acme/company-plan#one-inbox: 1 of 2 stories done (1 approved), 0 in progress");
    expect(text).toContain("  ├─ bet one-inbox (acme/company-plan)\n  │  └─ map inb (Web team): 1 of 2 stories done (1 approved)");
    expect(planningStatus(company)).toContain("one-inbox — delivery: in the plans below: map inb in acme/web-team, 1 of 2 stories done (1 approved)");

    // Both teams keep a valid file.
    expect(validate(a).errors).toEqual([]);
    expect(validate(b).errors).toEqual([]);
  });
});
