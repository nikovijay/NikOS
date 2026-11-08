// `nikos map status`, the holder-aware delivery and assign rules, against real local repos: a group
// with five stories, a web team and a pay team, each a git repo that the group fetches read-only.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { tmpdir } from "node:os";
import { assign } from "../src/commands/assign";
import { teamJoin } from "../src/commands/team";
import { teamSync } from "../src/team/sync";
import { setState } from "../src/commands/state";
import { approve } from "../src/commands/approve";
import { doctor } from "../src/commands/doctor";
import { formatMapStatus, mapStatus, runMapStatus, statusJson } from "../src/commands/map-status";
import { FRESHNESS, readTeamIndex } from "../src/team/status";
import { delivery, describeDelivery } from "../src/planning/delivery";
import { fetchCopy } from "../src/lib/fetch-copy";
import { verify } from "../src/commands/verify";
import { groupRepo, teamRepo, write, commitAll, feature } from "./team-fixture";
import { readAssignments } from "../src/lib/assignments";

vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
vi.mock("../src/lib/fetch-copy", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/fetch-copy")>();
  return { ...real, fetchCopy: vi.fn(real.fetchCopy) };
});
const runner = vi.mocked(verify);
const fetches = vi.mocked(fetchCopy);
beforeEach(() => {
  runner.mockClear();
  fetches.mockClear();
});

const story = (rs: ReturnType<typeof mapStatus>, id: string) => rs[0].stories.find((s) => s.id === id)!;

/** The group, with five stories in two releases: web holds release 1, pay holds PAY-CHK-3, 4 and 5 are unassigned. */
function setup() {
  const g = groupRepo("PAY");
  write(join(g, "maps/chk/features/confirm/see-totals.feature"), feature("PAY-CHK-4", "confirm", 2, "See totals"));
  write(join(g, "maps/chk/features/confirm/send-email.feature"), feature("PAY-CHK-5", "confirm", 2, "Send email"));
  const sm = parse(readFileSync(join(g, "maps/chk/storymap.yaml"), "utf8"));
  sm.releases[1].stories = ["PAY-CHK-3", "PAY-CHK-4", "PAY-CHK-5"];
  write(join(g, "maps/chk/storymap.yaml"), stringify(sm));
  commitAll(g, "five stories");
  const web = teamRepo("acme/checkout-web", "web");
  const pay = teamRepo("acme/checkout-pay", "pay");
  assign(g, "web", { repo: "acme/checkout-web", releases: [1], url: web });
  assign(g, "pay", { repo: "acme/checkout-pay", stories: ["PAY-CHK-3"], url: pay });
  commitAll(g, "assign");
  teamJoin(web, "acme/pay/checkout-group", { url: g });
  commitAll(web, "join");
  teamJoin(pay, "acme/pay/checkout-group", { url: g });
  commitAll(pay, "join");
  return { g, web, pay };
}

/** A story taken through in_progress and done in a team repo, committed. */
function finish(team: string, id: string, approveAs?: string) {
  setState(id, "in_progress", { dir: team });
  commitAll(team, "code");
  setState(id, "done", { dir: team, now: "2027-01-05T10:00:00Z", date: "2027-01-05" });
  commitAll(team, "done");
  if (approveAs) {
    approve(id, { dir: team, by: approveAs, date: "2027-01-06" });
    commitAll(team, "approve");
  }
}

describe("nikos map status: freshness", () => {
  it("a done story approved at its tested commit is current, and delivered", () => {
    const { g, web } = setup();
    finish(web, "PAY-CHK-1", "Priya Shah");
    const s = story(mapStatus(g), "PAY-CHK-1");
    expect(s).toMatchObject({ freshness: "current", team: "web", status: "done", delivery: "approved by Priya Shah", intent: "-" });
    expect(s.reason).toBe("done, approved by Priya Shah 2027-01-06");
  });

  it("a team that moved a story shows it as moved, until the team records the move in its own status", () => {
    const { g, web } = setup();
    setState("PAY-CHK-2", "in_progress", { dir: web });
    commitAll(web, "start");
    mapStatus(g); // the group records web as the holder it read
    assign(g, "pay", { repo: "acme/checkout-pay", stories: ["PAY-CHK-2"] });
    commitAll(g, "reassign");
    let s = story(mapStatus(g), "PAY-CHK-2");
    expect(s.freshness).toBe("moved");
    expect(s.reason).toBe("moved to pay; web hasn't committed the move (last in_progress)");
    expect(s.from).toEqual({ team: "web", status: "in_progress" });
    expect(s.status).toBe("todo");

    teamSync(web);
    commitAll(web, "sync");
    s = story(mapStatus(g), "PAY-CHK-2");
    expect(s.reason).toBe("moved to pay; web recorded the move (last in_progress)");
  });

  it("a done story whose feature changed since it was proved is changed", () => {
    const { g, web } = setup();
    finish(web, "PAY-CHK-1");
    write(join(g, "maps/chk/features/pay/pay-by-card.feature"), feature("PAY-CHK-1", "pay", 1, "Pay by card, with a receipt"));
    const s = story(mapStatus(g), "PAY-CHK-1");
    expect(s.freshness).toBe("changed");
    expect(s.reason).toBe("proved against an older feature: web runs nikos sync, then nikos state set <id> needs_rework, then in_progress, then done");
  });

  it("a status with no spec hash is unverified, until the team sets it again", () => {
    const { g, pay } = setup();
    write(join(pay, "status/PAY-CHK-3.yaml"), "status: todo\nupdated: 2027-01-04\n");
    commitAll(pay, "status by hand");
    expect(story(mapStatus(g), "PAY-CHK-3")).toMatchObject({ freshness: "unverified", reason: "pay set this before spec hashes: run nikos sync in pay, then nikos state set <id> needs_rework, then in_progress" });
    setState("PAY-CHK-3", "in_progress", { dir: pay });
    commitAll(pay, "start");
    expect(story(mapStatus(g), "PAY-CHK-3")).toMatchObject({ freshness: "current", status: "in_progress" });
  });

  it("a status that was written against an older feature is behind, while in progress", () => {
    const { g, pay } = setup();
    setState("PAY-CHK-3", "in_progress", { dir: pay });
    commitAll(pay, "start");
    write(join(g, "maps/chk/features/confirm/see-receipt.feature"), feature("PAY-CHK-3", "confirm", 2, "See the receipt, again"));
    const s = story(mapStatus(g), "PAY-CHK-3");
    expect(s.freshness).toBe("behind");
    expect(s.reason).toBe("pay's copy is behind the feature: run nikos sync in pay, then nikos state set <id> needs_rework, then in_progress");
  });

  it("a team whose repo can't be fetched shows as not fetched, and the command still exits 0", () => {
    const { g } = setup();
    assign(g, "pay", { repo: "acme/checkout-pay", stories: ["PAY-CHK-3"], url: join(tmpdir(), "no-such-nikos-team-repo") });
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(runMapStatus(["--dir", g])).toBe(0);
      const text = out.mock.calls.flat().join("\n");
      expect(text).toContain("fetch failed:");
      expect(text).toContain("todo (not fetched)"); // the group's own state, marked as not read from the team
    } finally {
      out.mockRestore();
    }
    const rs = mapStatus(g);
    expect(story(rs, "PAY-CHK-3")).toMatchObject({ freshness: "not-fetched" });
    expect(story(rs, "PAY-CHK-3").reason).toContain("(fetch failed:");
    expect(rs[0].teams.find((t) => t.team === "pay")).toMatchObject({ ok: false, retired: false });
    // The web rows are unaffected: web was fetched.
    expect(rs[0].teams.find((t) => t.team === "web")).toMatchObject({ ok: true });
  });

  it("a story nobody holds is unassigned, and a story a team holds with no status file has no status", () => {
    const { g, web } = setup();
    assign(g, "web", { repo: "acme/checkout-web", stories: ["PAY-CHK-5"], url: web });
    const rs = mapStatus(g);
    expect(story(rs, "PAY-CHK-4")).toMatchObject({ freshness: "unassigned", holder: null, team: null });
    expect(story(rs, "PAY-CHK-5")).toMatchObject({ freshness: "no-status", team: "web", status: "todo" });
    expect(story(rs, "PAY-CHK-5").reason).toBe("no status from web yet: it shows once web runs nikos sync and starts the story");
  });

  it("a story the group holds itself (--repo .) is in place, and has no delivery approval", () => {
    const { g } = setup();
    assign(g, "group", { repo: ".", stories: ["PAY-CHK-4"] });
    const s = story(mapStatus(g), "PAY-CHK-4");
    expect(s).toMatchObject({ freshness: "in-place", holder: ".", delivery: "n/a (in place)" });
    expect(s.reason).toBe("held by this group (--repo .)");
  });
});

describe("moves, releases and retired teams", () => {
  /** A second map in the group, with one story, so a team can be retired from one map and not the other. */
  function addOpsMap(g: string) {
    write(join(g, "maps/ops/storymap.yaml"), stringify({ format_version: 1, project: "ops", key: "OPS", bet: "faster-checkout", activities: [{ id: "pay", title: "Pay" }], releases: [{ number: 1, title: "First", stories: ["PAY-OPS-1"] }] }));
    write(join(g, "maps/ops/features/pay/refund.feature"), feature("PAY-OPS-1", "pay", 1, "Refund"));
    commitAll(g, "ops map");
  }

  it("a story released by one team and given to another is not shown as moved", () => {
    const { g, web } = setup();
    setState("PAY-CHK-2", "in_progress", { dir: web });
    commitAll(web, "start");
    mapStatus(g); // the group records web as the holder of PAY-CHK-2
    assign(g, "web", { repo: "acme/checkout-web", stories: ["PAY-CHK-1"], replace: true });
    commitAll(g, "release");
    assign(g, "pay", { repo: "acme/checkout-pay", stories: ["PAY-CHK-2"] });
    commitAll(g, "give");
    const s = story(mapStatus(g), "PAY-CHK-2");
    expect(s).toMatchObject({ freshness: "no-status", team: "pay", from: null });
  });

  it("a move made by assign is recorded before any map status runs, and shows the old team's last status", () => {
    const { g, web } = setup();
    finish(web, "PAY-CHK-1");
    assign(g, "pay", { repo: "acme/checkout-pay", stories: ["PAY-CHK-1"] });
    commitAll(g, "move");
    const s = story(mapStatus(g), "PAY-CHK-1");
    expect(s.freshness).toBe("moved");
    expect(s.reason).toBe("moved to pay; web hasn't committed the move (last done)");
    expect(s.from).toEqual({ team: "web", status: "done" });
    expect(readFileSync(join(g, ".gitignore"), "utf8")).toContain(".nikos/");
  });

  it("a team retired from one map is listed under that map only", () => {
    const { g, web, pay } = setup();
    addOpsMap(g);
    assign(g, "pay", { repo: "acme/checkout-pay", stories: ["PAY-OPS-1"], map: "ops", url: pay });
    commitAll(g, "ops");
    finish(web, "PAY-CHK-1");
    mapStatus(g); // reads web and pay as they are now
    // Pay takes web's last two stories in chk: web is retired from chk, and has nothing in ops.
    assign(g, "pay", { repo: "acme/checkout-pay", stories: ["PAY-CHK-1", "PAY-CHK-2", "PAY-CHK-3"], map: "chk", url: pay, includeDone: true });
    commitAll(g, "move");
    const rs = mapStatus(g);
    const chk = rs.find((r) => r.map === "chk")!;
    const ops = rs.find((r) => r.map === "ops")!;
    expect(chk.teams.find((t) => t.team === "web")).toMatchObject({ retired: true });
    expect(ops.teams.map((t) => t.team)).toEqual(["pay"]);
    expect(chk.stories.find((s) => s.id === "PAY-CHK-1")).toMatchObject({ freshness: "moved", team: "pay" });
    expect(chk.stories.find((s) => s.id === "PAY-CHK-1")!.reason).toBe("moved to pay; web hasn't committed the move (last done)");
  });

  it("assign --replace without --url or --ref keeps the team's stored location", () => {
    const { g, web } = setup();
    assign(g, "web", { repo: "acme/checkout-web", releases: [1], url: web, ref: "main" });
    assign(g, "web", { repo: "acme/checkout-web", releases: [1], replace: true });
    expect(readAssignments(join(g, "maps/chk")).find((a) => a.repo === "acme/checkout-web")).toMatchObject({ url: web, ref: "main" });
  });
});

describe("nikos map status: offline, json and the rest", () => {
  it("offline reads the last fetch without calling git, and shows the same rows", () => {
    const { g } = setup();
    const online = mapStatus(g);
    fetches.mockClear();
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(runMapStatus(["--dir", g, "--offline"])).toBe(0);
      expect(out.mock.calls.flat().join("\n")).toContain("offline: showing copies fetched");
    } finally {
      out.mockRestore();
    }
    expect(fetches).not.toHaveBeenCalled();
    expect(mapStatus(g, { offline: true }).map((r) => r.stories)).toEqual(online.map((r) => r.stories));
  });

  it("--json has the documented keys and a count for every freshness", () => {
    const { g, web } = setup();
    finish(web, "PAY-CHK-1", "Priya Shah");
    const j = statusJson(mapStatus(g)) as any;
    expect(Object.keys(j)).toEqual(["map", "key", "group", "offline", "assigned", "teams", "stories", "counts"]);
    expect(Object.keys(j.counts)).toEqual(FRESHNESS);
    // PAY-CHK-1 is current; 2 and 3 have no status yet; 4 and 5 are held by nobody.
    expect(j.counts).toMatchObject({ current: 1, "no-status": 2, unassigned: 2, "not-fetched": 0 });
    expect(Object.keys(j.stories[0])).toEqual(["id", "holder", "team", "status", "ticket", "freshness", "reason", "copy", "delivery", "intent", "awaiting", "from"]);
    expect(j.teams.map((t: any) => t.team)).toEqual(["web", "pay"]);
  });

  it("the human output names the teams, the stories and what needs attention", () => {
    const { g, web } = setup();
    finish(web, "PAY-CHK-1", "Priya Shah");
    const text = formatMapStatus(mapStatus(g)[0]);
    expect(text).toMatch(/^Map chk in .* \(5 stories, 2 teams\)/);
    expect(text).toContain("Teams");
    expect(text).toContain("STORY");
    expect(text).toContain("Needs attention");
    expect(text).toContain("PAY-CHK-4  -  nobody holds it: nikos assign gives it to a team");
  });

  it("a team repo is refused, and a group with no assignments says so", () => {
    const { web } = setup();
    expect(() => mapStatus(web)).toThrow("this is a team repo: run nikos map status in the group repo");
    const bare = groupRepo("PAY");
    const rs = mapStatus(bare);
    expect(rs[0].assigned).toBe(false);
    expect(formatMapStatus(rs[0])).toBe('No teams assigned to chk: run nikos assign "<team>" --repo <path> --map chk');
    expect(runMapStatus(["--dir", bare, "--map", "nope"])).toBe(1);
  });

  it("doctor says a team was never fetched, and says nothing about a group with no assignments", () => {
    const { g } = setup();
    expect(doctor(g).find((c) => c.name === "team web")).toMatchObject({ status: "warn", found: "web has never been fetched" });
    expect(doctor(groupRepo("PAY")).some((c) => c.name.startsWith("team "))).toBe(false);
  });
});

describe("delivery from the teams' status", () => {
  it("where approval is required, a bet counts approved, current done stories, and says what awaits approval", () => {
    const { g, web } = setup();
    write(join(g, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\n");
    commitAll(g, "require approval");
    finish(web, "PAY-CHK-1", "Priya Shah");
    finish(web, "PAY-CHK-2");
    mapStatus(g); // delivery reads the teams as last fetched
    const d = delivery(g, "faster-checkout");
    expect(d).toMatchObject({ status: "Building", done: 1, total: 5, awaiting: 1, notFetched: [] });
    expect(describeDelivery(d)).toBe(`Building, 1 of 5 done, 1 awaiting approval (team status as of ${d.asOf})`);
  });

  it("under the default policy a done story counts without an approval, and approvals off says so", () => {
    const { g, web } = setup();
    finish(web, "PAY-CHK-1");
    finish(web, "PAY-CHK-2");
    mapStatus(g);
    const d = delivery(g, "faster-checkout");
    expect(d).toMatchObject({ status: "Building", done: 2, total: 5, awaiting: 0 });
    expect(story(mapStatus(g), "PAY-CHK-1")).toMatchObject({ delivery: "not required (approval optional)", freshness: "current" });
    write(join(g, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: off\n");
    commitAll(g, "approvals off");
    expect(story(mapStatus(g), "PAY-CHK-1").delivery).toBe("not required (approvals off)");
  });

  it("a team's own delivery counts its own status, and shows Shipped once every story is approved", () => {
    const { web } = setup();
    finish(web, "PAY-CHK-1", "Priya Shah");
    finish(web, "PAY-CHK-2", "Priya Shah");
    const d = delivery(web, "faster-checkout");
    expect(d).toMatchObject({ status: "Shipped", done: 2, total: 2 });
    expect(describeDelivery(d)).toBe("Shipped, 2 of 2 done");
  });
});

describe("assign reads the holder's status", () => {
  it("refuses to move a story the holder's copy says is done, and names where it read it", () => {
    const { g, web } = setup();
    finish(web, "PAY-CHK-1");
    mapStatus(g); // fetches web, so the group has its status
    const fetched = readTeamIndex(g).teams["acme/checkout-web"];
    expect(() => assign(g, "pay", { repo: "acme/checkout-pay", stories: ["PAY-CHK-1"] })).toThrow(
      `PAY-CHK-1 is done and held by web (status read from acme/checkout-web status/, fetched ${fetched.fetched} at ${fetched.commit!.slice(0, 7)}): assign won't move a done story (use --include-done)`,
    );
  });

  it("with no copy of the holder, checks the group's own state.yaml and warns", () => {
    const { g, web } = setup();
    finish(web, "PAY-CHK-1");
    const r = assign(g, "pay", { repo: "acme/checkout-pay", stories: ["PAY-CHK-1"] });
    expect(r.warnings).toEqual(["PAY-CHK-1 is held by web, which isn't fetched: checked the group's own state.yaml (run nikos map status first)"]);
  });

  it("--include-done moves a done story and says the approval stays with the old team; url and ref are stored only when given", () => {
    const { g, web, pay } = setup();
    finish(web, "PAY-CHK-1", "Priya Shah");
    mapStatus(g);
    const r = assign(g, "pay", { repo: "acme/checkout-pay", stories: ["PAY-CHK-1"], includeDone: true, url: pay, ref: "trunk" });
    expect(r.notes).toEqual(["1 done story moved from web: new team starts at todo; delivery approval stays with web"]);
    const saved = parse(readFileSync(join(g, "maps/chk/assignments.yaml"), "utf8"));
    expect(saved.find((a: any) => a.repo === "acme/checkout-pay")).toMatchObject({ url: pay, ref: "trunk" });
    expect(saved.find((a: any) => a.repo === "acme/checkout-web")).toMatchObject({ url: web });
    expect(saved.find((a: any) => a.repo === "acme/checkout-web")).not.toHaveProperty("ref");
  });
});
