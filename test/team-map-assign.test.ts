// A team that owns a story map assigns its stories (its own share as --repo ., another team's
// share as a team repo), and reads their status with nikos map status, writing its delivery.yaml
// (rule 7 and rule 9). A team with no map of its own keeps the 0.3.0 refusals.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { assign } from "../src/commands/assign";
import { teamInit, teamJoin } from "../src/commands/team";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { setState } from "../src/commands/state";
import { approve } from "../src/commands/approve";
import { mapStatus, writeSummaries } from "../src/commands/map-status";
import { teamSync } from "../src/team/sync";
import { readDeliverySummary } from "../src/lib/delivery-summary";
import { readAssignments } from "../src/lib/assignments";
import { verify } from "../src/commands/verify";
import { doctor } from "../src/commands/doctor";
import { git, write, commitAll } from "./team-fixture";

vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
beforeEach(() => vi.mocked(verify).mockClear());

const status = (t: string, id: string) => parse(readFileSync(join(t, "status", `${id}.yaml`), "utf8"));

/** A team repo with a key, a home and a bet of its own, with an origin so its delivery summary can name it. */
function teamAt(key: string | undefined, repo: string, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-assign-"));
  write(join(dir, "package.json"), `{"name":"${repo.split("/")[1]}","private":true}\n`);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", `https://github.com/${repo}.git`);
  teamInit(dir, { repo, name, ...(key ? { key } : {}) });
  if (key) write(join(dir, "nikos.team.yaml"), `format_version: 2\nname: ${name}\nrepo: ${repo}\nkey: ${key}\nhome: acme/payments-group\ngroups: []\nmembers: []\n`);
  write(join(dir, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
  commitAll(dir, "team");
  return dir;
}

/** Team A (WEB) owns INB with two stories, WEB-INB-1 and WEB-INB-2, and its own map's bet. */
function owner(): string {
  const a = teamAt("WEB", "acme/web-team", "Web team");
  newMap({ bet: "faster-checkout", key: "INB" }, a);
  newStory({ title: "Pay by card", activity: "getting-started" }, a);
  newStory({ title: "Pay by wallet", activity: "getting-started" }, a);
  commitAll(a, "map");
  return a;
}

describe("a team's own map: assign and map status", () => {
  it("assigns its own share as --repo . and another team's share, in maps/<key>/assignments.yaml", () => {
    const a = owner();
    const b = teamAt("IOS", "acme/ios-team", "iOS team");
    assign(a, "Web team", { repo: ".", stories: ["WEB-INB-1"] });
    const r = assign(a, "iOS team", { repo: "acme/ios-team", stories: ["WEB-INB-2"], url: b });
    expect(r).toMatchObject({ map: "INB", stories: 1, unassigned: [] });
    expect(readAssignments(join(a, "maps/inb")).map((x) => [x.repo, x.stories])).toEqual([
      [".", ["WEB-INB-1"]],
      ["acme/ios-team", ["WEB-INB-2"]],
    ]);
  });

  it("is refused for a team with no map of its own, with the 0.3.0 wording, and a team's copy of a map", () => {
    const plain = teamAt(undefined, "acme/plain-team", "Plain team");
    expect(() => assign(plain, "x", { repo: "acme/x", stories: ["X-1"] })).toThrow("assignments are made in the group repo");
    const a = owner();
    const b = teamAt("IOS", "acme/ios-team", "iOS team");
    assign(a, "iOS team", { repo: "acme/ios-team", stories: ["WEB-INB-2"], url: b });
    commitAll(a, "assign");
    teamJoin(b, "acme/web-team", { url: a });
    expect(() => assign(b, "x", { repo: "acme/x", stories: ["WEB-INB-2"] })).toThrow("assignments are made in the group repo, or in a team repo for a map it owns");
  });

  it("reads its own stories in place and the other team's status, and writes its delivery.yaml", () => {
    const a = owner();
    const b = teamAt("IOS", "acme/ios-team", "iOS team");
    assign(a, "Web team", { repo: ".", stories: ["WEB-INB-1"] });
    assign(a, "iOS team", { repo: "acme/ios-team", stories: ["WEB-INB-2"], url: b });
    commitAll(a, "assign");
    teamJoin(b, "acme/web-team", { url: a });
    expect(teamSync(b).groups.map((g) => g.stories)).toEqual([1]);
    setState("WEB-INB-2", "in_progress", { dir: b, by: "Priya" });
    setState("WEB-INB-2", "done", { dir: b, by: "Priya" });
    approve("WEB-INB-2", { dir: b, by: "Priya Shah", date: "2027-01-06" });
    commitAll(b, "delivered");

    const [m] = mapStatus(a);
    expect(m.map).toBe("inb");
    expect(m.stories.find((s) => s.id === "WEB-INB-1")).toMatchObject({ holder: ".", freshness: "in-place" });
    expect(m.stories.find((s) => s.id === "WEB-INB-2")).toMatchObject({ team: "iOS team", freshness: "current", delivery: "approved by Priya Shah" });

    const written = writeSummaries(a, [m]).written;
    expect(written).toEqual([join(a, "maps/inb/delivery.yaml")]);
    const summary = readDeliverySummary(join(a, "maps/inb"));
    expect(summary).toMatchObject({ map: "inb", owner: "acme/web-team" });
    expect(summary?.stories.find((s) => s.id === "WEB-INB-2")).toMatchObject({ team: "acme/ios-team", status: "done", approval: "approved", approved_by: "Priya Shah" });
    // The team's own state is in its status/ at the root, and the map has no state file of its own.
    expect(existsSync(join(a, "maps/inb/state.yaml"))).toBe(false);
    expect(status(a, "WEB-INB-1")).toMatchObject({ status: "todo" });
  });

  it("doctor suggests a CODEOWNERS rule for the assignments, naming the home's lead or a placeholder", () => {
    const a = owner();
    const line = () => doctor(a, { offline: true }).find((c) => c.name === "assignments");
    expect(line()?.next).toBe('Suggest: add "maps/inb/assignments.yaml @<home-lead>" to CODEOWNERS, so the home group\'s lead reviews every change to a share');
    // The home's lead comes from the home's plan, once it is in the team's copy: a suggestion only, nothing is written.
    write(join(a, ".nikos/upstream/acme/payments-group/planning/plan.yaml"), "name: Payments\nkey: PAY\nperiod: Q1 2027\nlevel: group\npillars: []\nlead: priya\n");
    expect(line()?.next).toContain('"maps/inb/assignments.yaml @priya"');
    expect(existsSync(join(a, "CODEOWNERS"))).toBe(false);
  });

  it("a team with no map of its own is still refused by map status with the 0.3.0 wording", () => {
    const plain = teamAt(undefined, "acme/plain-team", "Plain team");
    expect(() => mapStatus(plain)).toThrow("this is a team repo: run nikos map status in the group repo");
  });
});
