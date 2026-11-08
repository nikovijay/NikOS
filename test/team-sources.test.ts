// A team takes stories from another team that owns a map, as it takes them from a group (rule 7):
// nikos team join <team A repo>, then nikos sync copies the stories assigned to it, read-only.
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
import { validate } from "../src/commands/validate";
import { verify } from "../src/commands/verify";
import { writeAssignments } from "../src/lib/assignments";
import { assignedMaps, storyMapFor } from "../src/lib/maps";
import { teamSync } from "../src/team/sync";
import { git, groupRepo, teamRepo, write, commitAll } from "./team-fixture";

vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
beforeEach(() => vi.mocked(verify).mockClear());

const status = (t: string, id: string) => parse(readFileSync(join(t, "status", `${id}.yaml`), "utf8"));
const copyOf = (t: string, repo: string) => join(t, ".nikos", "assigned", ...repo.split("/"));

/** A team repo with a key and a home, committed. */
function team(key: string, repo: string, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-src-"));
  write(join(dir, "package.json"), `{"name":"${key.toLowerCase()}","private":true}\n`);
  git(dir, "init", "-q", "-b", "main");
  teamInit(dir, { repo, name, key });
  write(join(dir, "nikos.team.yaml"), `format_version: 2\nname: ${name}\nrepo: ${repo}\nkey: ${key}\nhome: acme/payments-group\ngroups: []\nmembers: []\n`);
  write(join(dir, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
  commitAll(dir, "team");
  return dir;
}

/** Team A owns INB with one story (WEB-INB-1), assigned to the team at iosRepo. */
function ownerTeam(iosRepo: string): string {
  const a = team("WEB", "acme/web-team", "Web team");
  newMap({ bet: "faster-checkout", key: "INB" }, a);
  newStory({ title: "Pay by card", activity: "getting-started" }, a);
  writeAssignments(join(a, "maps/inb"), [{ team: "iOS team", repo: iosRepo, stories: ["WEB-INB-1"] }]);
  commitAll(a, "map and assignment");
  return a;
}

describe("a team that takes stories from another team", () => {
  it("joins it as a source, syncs its stories read-only, and holds its status in its own repo", () => {
    const a = ownerTeam("acme/ios-team");
    const b = team("IOS", "acme/ios-team", "iOS team");
    const r = teamJoin(b, "acme/web-team", { url: a });
    expect(r).toMatchObject({ repo: "acme/web-team", stories: 1 });
    expect(r.unresolved).toBeUndefined();

    const copy = copyOf(b, "acme/web-team");
    expect(existsSync(join(copy, "maps/inb/storymap.yaml"))).toBe(true);
    expect(existsSync(join(copy, "maps/inb/features"))).toBe(true);
    // Only the team's maps are copied: its plan, bets, settings and upstream stay with it.
    expect(existsSync(join(copy, "planning"))).toBe(false);
    expect(existsSync(join(copy, "nikos.settings.yaml"))).toBe(false);

    expect(assignedMaps(b).map((m) => m.copyRoot)).toEqual([copy]);
    const ref = storyMapFor(b, { story: "WEB-INB-1" });
    expect(ref).toMatchObject({ team: true, id: "inb", root: b });
    expect(ref.own).toBeUndefined();

    setState("WEB-INB-1", "in_progress", { dir: b, by: "Priya" });
    expect(status(b, "WEB-INB-1")).toMatchObject({ status: "in_progress" });
    // Team A's own status for the story is its own: still todo, and B's move didn't touch it.
    expect(status(a, "WEB-INB-1")).toMatchObject({ status: "todo" });
    expect(validate(b).errors).toEqual([]);
  });

  it("is refused a source whose team doesn't own maps and has no key, and keeps nothing of it", () => {
    const b = team("IOS", "acme/ios-team", "iOS team");
    const keyless = teamRepo("acme/keyless-team", "Keyless");
    expect(() => teamJoin(b, "acme/keyless-team", { url: keyless })).toThrow("has no key in nikos.team.yaml");
    expect(readFileSync(join(b, "nikos.team.yaml"), "utf8")).not.toContain("keyless-team");
    expect(existsSync(copyOf(b, "acme/keyless-team"))).toBe(false);
  });

  it("is refused a source with the team's own key, since its story ids would collide", () => {
    const a = ownerTeam("acme/ios-team");
    const b = team("WEB", "acme/ios-team", "Second web team");
    expect(() => teamJoin(b, "acme/web-team", { url: a })).toThrow("uses key WEB, which this team uses");
    expect(readFileSync(join(b, "nikos.team.yaml"), "utf8")).not.toContain("acme/web-team");
  });

  it("refuses a team joining itself, and a company plan as a source", () => {
    const a = ownerTeam("acme/ios-team");
    expect(() => teamJoin(a, "acme/web-team", { url: a })).toThrow("a team takes stories from another repo");
    const company = mkdtempSync(join(tmpdir(), "nikos-company-"));
    write(join(company, "planning/plan.yaml"), "name: Acme\nkey: ACME\nperiod: Q1 2027\nlevel: company\npillars: []\n");
    git(company, "init", "-q", "-b", "main");
    commitAll(company, "company");
    const b = team("IOS", "acme/ios-team", "iOS team");
    expect(() => teamJoin(b, "acme/acme-plan", { url: company })).toThrow("is not a group plan");
  });

  it("takes stories from a group and from a team at once, each under its own key", () => {
    const g = groupRepo("PAY");
    assign(g, "iOS team", { repo: "acme/ios-team", releases: [1] });
    commitAll(g, "assign");
    const a = ownerTeam("acme/ios-team");
    const b = team("IOS", "acme/ios-team", "iOS team");
    teamJoin(b, "acme/pay/checkout-group", { url: g });
    teamJoin(b, "acme/web-team", { url: a });
    const r = teamSync(b);
    expect(r.groups.map((x) => [x.repo, x.stories])).toEqual([
      ["acme/pay/checkout-group", 2],
      ["acme/web-team", 1],
    ]);
    expect(assignedMaps(b)).toHaveLength(2);
    expect(storyMapFor(b, { story: "PAY-CHK-1" }).copyRoot).toBe(copyOf(b, "acme/pay/checkout-group"));
    expect(storyMapFor(b, { story: "WEB-INB-1" }).copyRoot).toBe(copyOf(b, "acme/web-team"));
    expect(validate(b).errors).toEqual([]);
  });

  it("drops a source it no longer takes stories from, with its copy", () => {
    const a = ownerTeam("acme/ios-team");
    const b = team("IOS", "acme/ios-team", "iOS team");
    teamJoin(b, "acme/web-team", { url: a });
    expect(existsSync(copyOf(b, "acme/web-team"))).toBe(true);
    write(join(b, "nikos.team.yaml"), readFileSync(join(b, "nikos.team.yaml"), "utf8").replace(/groups:[\s\S]*?members/, "groups: []\nmembers"));
    teamSync(b);
    expect(existsSync(copyOf(b, "acme/web-team"))).toBe(false);
  });
});
