// A team that owns a story map (after 0.3.0): maps/<key>/ in its own repo, its ids carrying the
// team's key (WEB-INB-1), its status in its own status/, and its bets checked against the plans it joins.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { teamInit } from "../src/commands/team";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { setState } from "../src/commands/state";
import { validate } from "../src/commands/validate";
import { verify } from "../src/commands/verify";
import { storyMapClash } from "../src/lib/team";
import { keyOf, ownMapsOf, storyMapFor } from "../src/lib/maps";
import { git, write, commitAll, teamRepo } from "./team-fixture";

// The runner is a stand-in here: each test says whether the scenarios pass.
vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
beforeEach(() => vi.mocked(verify).mockClear());

const status = (t: string, id: string) => parse(readFileSync(join(t, "status", `${id}.yaml`), "utf8"));

/** Write nikos.team.yaml in the format a team with a key and a home has. */
function setTeamFile(t: string, opts: { key?: string; home?: string } = {}) {
  const key = opts.key ? `key: ${opts.key}\n` : "";
  const home = opts.home ? `home: ${opts.home}\n` : "";
  write(join(t, "nikos.team.yaml"), `format_version: 2\nname: Web team\nrepo: acme/web-team\n${key}${home}groups: []\nmembers: []\n`);
}

/** A team repo with a key (WEB) and a home, and one bet of its own, committed. */
function teamWithKey(key = "WEB") {
  const dir = mkdtempSync(join(tmpdir(), "nikos-own-"));
  write(join(dir, "package.json"), '{"name":"web","private":true}\n');
  git(dir, "init", "-q", "-b", "main");
  teamInit(dir, { repo: "acme/web-team", name: "Web team", key });
  setTeamFile(dir, { key, home: "acme/payments-group" });
  write(join(dir, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
  commitAll(dir, "team");
  return dir;
}

describe("a team's own map", () => {
  it("is maps/<key>/ in the team repo, and its stories take the team's key", () => {
    const t = teamWithKey();
    const made = newMap({ bet: "faster-checkout", key: "INB" }, t);
    expect(made).toMatchObject({ id: "inb", key: "INB", group: "WEB" });
    expect(existsSync(join(t, "maps/inb/storymap.yaml"))).toBe(true);
    expect(existsSync(join(t, "maps/inb/state.yaml"))).toBe(false);

    const story = newStory({ title: "Pay by card", activity: "getting-started" }, t);
    expect(story.id).toBe("WEB-INB-1");
    expect(existsSync(join(t, "maps/inb/features"))).toBe(true);
    // The story's state is the team's own: status/ at the team root, not in the map.
    expect(status(t, "WEB-INB-1")).toMatchObject({ status: "todo" });
    expect(existsSync(join(t, "maps/inb/state"))).toBe(false);
  });

  it("is found by its map key, by its folder and by its label, and a team with one map needs no flag", () => {
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    newStory({ title: "Pay by card", activity: "getting-started" }, t);
    expect(storyMapFor(t, { story: "WEB-INB-1" }).id).toBe("inb");
    expect(storyMapFor(t, { map: "INB" }).id).toBe("inb");
    expect(storyMapFor(t, { map: "inb" }).id).toBe("inb");
    expect(storyMapFor(t, { map: "WEB-INB" }).id).toBe("inb");
    expect(keyOf(t)).toBe("WEB");
    expect(ownMapsOf(t).map((r) => r.id)).toEqual(["inb"]);
  });

  it("needs the team's key: map new refuses a team without one", () => {
    const t = teamWithKey();
    setTeamFile(t, { home: "acme/payments-group" });
    expect(() => newMap({ bet: "faster-checkout", key: "INB" }, t)).toThrow("a team that owns a map needs a key");
  });

  it("names a bet of its own, or a bet of a plan it joins (<repo>#<id>), and refuses the rest", () => {
    const t = teamWithKey();
    expect(() => newMap({ bet: "nope", key: "INB" }, t)).toThrow("no planning/bets/nope.md");
    expect(() => newMap({ bet: "acme/company-plan#one-inbox", key: "INB" }, t)).toThrow("isn't a plan this team joins");
    write(join(t, "planning/upstream.yaml"), "- repo: acme/company-plan\n  ref: main\n");
    newMap({ bet: "acme/company-plan#one-inbox", key: "INB" }, t);
    expect(parse(readFileSync(join(t, "maps/inb/storymap.yaml"), "utf8")).bet).toBe("acme/company-plan#one-inbox");
  });

  it("is refused a second map with a key already used, and a key that isn't one", () => {
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    expect(() => newMap({ bet: "faster-checkout", key: "INB" }, t)).toThrow("map key INB is already used by maps/inb");
    expect(() => newMap({ bet: "faster-checkout", key: "inb" }, t)).toThrow("map key must be uppercase");
  });

  it("with two maps, a story command needs --map", () => {
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    newMap({ bet: "faster-checkout", key: "PAY" }, t);
    expect(() => newStory({ title: "Pay", activity: "getting-started" }, t)).toThrow("several story maps");
    expect(newStory({ title: "Pay", activity: "getting-started", map: "PAY" }, t).id).toBe("WEB-PAY-1");
  });

  it("a team repo with no own map keeps the 0.3.0 refusal for stories", () => {
    const t = teamRepo();
    expect(() => newStory({ title: "Pay", activity: "pay" }, t)).toThrow("this is a team repo: stories are added in the group repo");
    expect(ownMapsOf(t)).toEqual([]);
    rmSync(t, { recursive: true, force: true });
  });

  it("validates clean, with the folder named for the key", () => {
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    newStory({ title: "Pay by card", activity: "getting-started" }, t);
    commitAll(t, "map");
    const v = validate(t);
    expect(v.errors).toEqual([]);
    expect(v.stories).toBe(1);
  });

  it("reports a folder that doesn't match its key, and a team with a map and no key", () => {
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    write(join(t, "maps/inb/storymap.yaml"), readFileSync(join(t, "maps/inb/storymap.yaml"), "utf8").replace("key: INB", "key: ABC"));
    expect(validate(t).errors.map((e) => e.message)).toContain("maps/inb has key 'ABC', so its folder should be maps/abc");

    setTeamFile(t, { home: "acme/payments-group" });
    write(join(t, "maps/inb/storymap.yaml"), readFileSync(join(t, "maps/inb/storymap.yaml"), "utf8").replace("key: ABC", "key: INB"));
    expect(validate(t).errors.map((e) => e.message)).toContain("a team that owns a map needs a key (nikos team init --key WEB)");
  });

  it("refuses a bet of a plan it doesn't join, in validate", () => {
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    write(join(t, "maps/inb/storymap.yaml"), readFileSync(join(t, "maps/inb/storymap.yaml"), "utf8").replace("bet: faster-checkout", "bet: acme/company-plan#one-inbox"));
    expect(validate(t).errors.map((e) => e.message).join("\n")).toContain("but this team doesn't join acme/company-plan");
  });

  it("keeps intent/ refused beside nikos.team.yaml, and lets maps/ through", () => {
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    expect(storyMapClash(t)).toBeUndefined();
    write(join(t, "intent/storymap.yaml"), "format_version: 1\n");
    expect(storyMapClash(t)).toBe("this repo has intent/ or maps/ and nikos.team.yaml: keep one");
  });

  it("runs state set and approve on its own stories in the team's status/", () => {
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    newStory({ title: "Pay by card", activity: "getting-started" }, t);
    commitAll(t, "story");
    setState("WEB-INB-1", "in_progress", { dir: t, by: "Priya" });
    expect(status(t, "WEB-INB-1")).toMatchObject({ status: "in_progress", claimed_by: "Priya" });
    setState("WEB-INB-1", "done", { dir: t, by: "Priya" });
    expect(status(t, "WEB-INB-1")).toMatchObject({ status: "done" });
    expect(status(t, "WEB-INB-1").spec_hash).toMatch(/^[0-9a-f]+$/);
    expect(existsSync(join(t, "maps/inb/state.yaml"))).toBe(false);
  });

  it("refuses a story that isn't in the map's features", () => {
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    expect(() => storyMapFor(t, { story: "WEB-PAY-1" })).toThrow("is not in any of this team's maps");
    expect(() => storyMapFor(t, { story: "WEB-INB-9" })).toThrow("is not in maps/inb/features");
    newStory({ title: "Pay by card", activity: "getting-started" }, t);
    expect(() => storyMapFor(t, { story: "WEB-INB-9" })).toThrow("is not in maps/inb/features");
  });

  it("is the team's only map: a team with one map of its own needs no --map", () => {
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    expect(ownMapsOf(t).map((r) => r.id)).toEqual(["inb"]);
    expect(storyMapFor(t).id).toBe("inb");
  });
});

describe("a team's own bets, approval and next", () => {
  it("planning bet new in a team repo writes planning/bets/<id>.md", async () => {
    const { newBet } = await import("../src/planning/bets");
    const t = teamWithKey();
    const path = newBet({ id: "one-inbox", owner: "Ada", hypothesis: "One inbox helps", reviewOn: "2027-03-01", alignsTo: [] }, t);
    expect(path).toBe("planning/bets/one-inbox.md");
    expect(readFileSync(join(t, path), "utf8")).toContain("id: one-inbox");
  });

  it("approve records the approval in the team's approvals/, and next lists the team's own stories", async () => {
    const { approve } = await import("../src/commands/approve");
    const { next } = await import("../src/commands/next");
    const t = teamWithKey();
    newMap({ bet: "faster-checkout", key: "INB" }, t);
    newStory({ title: "Pay by card", activity: "getting-started" }, t);
    commitAll(t, "story");
    expect(next(t).story).toBe("WEB-INB-1");
    setState("WEB-INB-1", "in_progress", { dir: t, by: "Priya" });
    setState("WEB-INB-1", "done", { dir: t, by: "Priya" });
    commitAll(t, "done");
    approve("WEB-INB-1", { dir: t, by: "Priya", via: "terminal" });
    expect(parse(readFileSync(join(t, "approvals/WEB-INB-1.yaml"), "utf8"))).toMatchObject({ by: "Priya" });
    expect(existsSync(join(t, "maps/inb/approvals"))).toBe(false);
  });
});
