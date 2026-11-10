// `nikos map status`, read from each map's own files: a group's state and approvals, and a repo's
// own map from its own state.yaml and approvals/. No git or network: the proof of a status is judged
// against the feature it sits beside, and each map's delivery.yaml is written from what it reads.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { setState } from "../src/commands/state";
import { approve } from "../src/commands/approve";
import { formatMapStatus, mapStatus, runMapStatus, statusJson, writeSummaries } from "../src/commands/map-status";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { readDeliverySummary } from "../src/lib/delivery-summary";
import { verify } from "../src/commands/verify";
import { fetchCopy } from "../src/lib/fetch-copy";
import { spawnSync } from "node:child_process";
import { groupRepo, git, write, commitAll } from "./repo-fixture";

vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return { ...real, spawnSync: vi.fn(real.spawnSync) };
});
vi.mock("../src/lib/fetch-copy", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/fetch-copy")>();
  return { ...real, fetchCopy: vi.fn(real.fetchCopy) };
});
beforeEach(() => {
  vi.mocked(verify).mockClear();
  vi.mocked(fetchCopy).mockClear();
});

const story = (rs: ReturnType<typeof mapStatus>, id: string) => rs[0].stories.find((s) => s.id === id)!;
const NOW = new Date("2027-01-05T10:00:00Z");

/** A group repo with a bet and one map of its own (INB) with two stories: PAY-INB-1 and -2. */
function ownMapRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-own-status-"));
  write(join(dir, "package.json"), '{"name":"web","private":true}\n');
  git(dir, "init", "-q", "-b", "main");
  write(join(dir, "planning/plan.yaml"), "name: Checkout\nkey: PAY\nperiod: Q1 2027\nlevel: group\npillars: []\n");
  write(join(dir, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
  commitAll(dir, "group");
  newMap({ bet: "faster-checkout", key: "INB" }, dir);
  newStory({ title: "Pay by card", activity: "getting-started" }, dir);
  newStory({ title: "Pay by wallet", activity: "getting-started" }, dir);
  commitAll(dir, "map");
  return dir;
}

/** A change to a feature file: its text changes, so its fingerprint does. */
const reword = (path: string) => write(path, `${readFileSync(path, "utf8")}\n# reworded\n`);
const CARD = "maps/inb/features/getting-started/pay-by-card.feature";

describe("nikos map status: a group's map", () => {
  it("reads each story's state and approval from the map's own files, with no git or network call", () => {
    const g = groupRepo("PAY");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.mocked(spawnSync).mockClear();
    const rs = mapStatus(g);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ map: "chk", key: "CHK", owner: "PAY", counts: { stories: 3, done: 0, approved: 0, notCurrent: 0 } });
    expect(story(rs, "PAY-CHK-1")).toMatchObject({ status: "todo", approval: "none" });
    expect(fetchCopy).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("a cancelled story is not behind, even when its feature changed after it was started", () => {
    const g = groupRepo("PAY");
    setState("PAY-CHK-1", "in_progress", { dir: g });
    setState("PAY-CHK-1", "cancelled", { dir: g, reason: "dropped" });
    reword(join(g, "maps/chk/features/pay/pay-by-card.feature"));
    const rs = mapStatus(g);
    expect(story(rs, "PAY-CHK-1")).toMatchObject({ status: "cancelled" });
    expect(JSON.stringify(rs)).not.toContain("behind");
  });

  it("a done story is done, and an approval that holds shows who gave it", () => {
    const g = groupRepo("PAY");
    setState("PAY-CHK-1", "in_progress", { dir: g });
    setState("PAY-CHK-1", "done", { dir: g, now: "2027-01-05T10:00:00Z", date: "2027-01-05" });
    expect(story(mapStatus(g), "PAY-CHK-1")).toMatchObject({ status: "done", approval: "none" });
    approve("PAY-CHK-1", { dir: g, by: "Priya Shah", date: "2027-01-06" });
    expect(story(mapStatus(g), "PAY-CHK-1")).toMatchObject({ status: "done", approval: "approved", approved_by: "Priya Shah" });
    expect(mapStatus(g)[0].counts).toMatchObject({ done: 1, approved: 1 });
  });

  it("an approval still shows after approval.policy is switched off: the record is read whatever the policy", () => {
    const g = groupRepo("PAY");
    setState("PAY-CHK-1", "in_progress", { dir: g });
    setState("PAY-CHK-1", "done", { dir: g });
    approve("PAY-CHK-1", { dir: g, by: "Priya Shah", date: "2027-01-06" });
    write(join(g, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: off\n");
    commitAll(g, "approvals off");
    expect(story(mapStatus(g), "PAY-CHK-1")).toMatchObject({ approval: "approved", approved_by: "Priya Shah" });
  });

  it("a map's summary is written by nikos map status and says the same as the files", () => {
    const g = groupRepo("PAY");
    const written = writeSummaries(g, mapStatus(g), NOW);
    expect(written).toEqual([join(g, "maps/chk/delivery.yaml")]);
    expect(readDeliverySummary(join(g, "maps/chk"))?.stories.map((s) => [s.id, s.status])).toEqual([
      ["PAY-CHK-1", "todo"],
      ["PAY-CHK-2", "todo"],
      ["PAY-CHK-3", "todo"],
    ]);
  });

  it("the --json output has the documented keys, and a count for each part of the status", () => {
    const g = groupRepo("PAY");
    const j = statusJson(mapStatus(g)) as any;
    expect(Object.keys(j)).toEqual(["map", "key", "owner", "stories", "counts"]);
    expect(Object.keys(j.stories[0])).toEqual(["id", "status", "approval", "reason"]);
    expect(Object.keys(j.counts)).toEqual(["stories", "done", "approved", "notCurrent"]);
  });

  it("the human output names the owner and the counts, and lists what needs attention", () => {
    const g = groupRepo("PAY");
    const text = formatMapStatus(mapStatus(g)[0]);
    expect(text).toMatch(/^Map chk owned by PAY \(3 stories, 0 done, 0 approved\)/);
    expect(text).toContain("STORY");
    expect(text).not.toContain("Needs attention");
  });

  it("with --json, prints and writes nothing; otherwise it writes the map's delivery.yaml", () => {
    const g = groupRepo("PAY");
    rmSync(join(g, "maps/chk/delivery.yaml")); // the fixture writes one; this test starts without it
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(runMapStatus(["--dir", g, "--json"])).toBe(0);
      expect(out.mock.calls.flat().join("\n")).toContain('"owner": "PAY"');
      expect(existsSync(join(g, "maps/chk/delivery.yaml"))).toBe(false);
      expect(runMapStatus(["--dir", g])).toBe(0);
      expect(existsSync(join(g, "maps/chk/delivery.yaml"))).toBe(true);
      expect(out.mock.calls.flat().join("\n")).toContain("Wrote");
    } finally {
      out.mockRestore();
    }
  });

  it("an unknown --map, and a repo with no maps, are errors", () => {
    const g = groupRepo("PAY");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(runMapStatus(["--dir", g, "--map", "nope"])).toBe(1);
      expect(() => mapStatus(join(g, "planning"))).toThrow("no story maps in maps/");
    } finally {
      err.mockRestore();
    }
  });
});

describe("nikos map status: a repo's own map", () => {
  it("reads the map's own state, judged against the feature it was written against", () => {
    const t = ownMapRepo();
    setState("PAY-INB-1", "in_progress", { dir: t });
    commitAll(t, "start");
    expect(story(mapStatus(t), "PAY-INB-1")).toMatchObject({ status: "in_progress" });
    expect(story(mapStatus(t), "PAY-INB-1").reason).toBe("");
  });

  it("a done story proved against an older feature is changed, and needs attention", () => {
    const t = ownMapRepo();
    setState("PAY-INB-1", "in_progress", { dir: t });
    commitAll(t, "start");
    setState("PAY-INB-1", "done", { dir: t });
    commitAll(t, "done");
    reword(join(t, CARD));
    const s = story(mapStatus(t), "PAY-INB-1");
    expect(s).toMatchObject({ status: "done", proof: "changed" });
    expect(s.reason).toMatch(/feature changed after it was proved/);
    expect(formatMapStatus(mapStatus(t)[0])).toContain("Needs attention");
    expect(mapStatus(t)[0].counts).toMatchObject({ done: 0, notCurrent: 1 });
  });

  it("an in-progress story written against an older feature is behind", () => {
    const t = ownMapRepo();
    setState("PAY-INB-1", "in_progress", { dir: t });
    commitAll(t, "start");
    reword(join(t, CARD));
    expect(story(mapStatus(t), "PAY-INB-1")).toMatchObject({ status: "in_progress", proof: "behind" });
  });

  it("a done status with no spec hash is unverified", () => {
    const t = ownMapRepo();
    write(join(t, "maps/inb/state.yaml"), "format_version: 1\nstories:\n  PAY-INB-1: { status: in_progress }\n  PAY-INB-2: { status: done, updated: 2027-01-04 }\n");
    commitAll(t, "status by hand");
    expect(story(mapStatus(t), "PAY-INB-2")).toMatchObject({ status: "done", proof: "unverified" });
  });

  it("a map's own approval shows, and is written to its delivery.yaml", () => {
    const t = ownMapRepo();
    setState("PAY-INB-1", "in_progress", { dir: t, by: "Ada" });
    commitAll(t, "start");
    setState("PAY-INB-1", "done", { dir: t, by: "Ada" });
    commitAll(t, "done");
    expect(story(mapStatus(t), "PAY-INB-1")).toMatchObject({ status: "done", approval: "none" });
    approve("PAY-INB-1", { dir: t, by: "Ada Lovelace", date: "2027-01-06" });
    commitAll(t, "approved");
    expect(story(mapStatus(t), "PAY-INB-1")).toMatchObject({ approval: "approved", approved_by: "Ada Lovelace" });
    writeSummaries(t, mapStatus(t), NOW);
    expect(readDeliverySummary(join(t, "maps/inb"))?.stories.find((s) => s.id === "PAY-INB-1")).toMatchObject({ status: "done", approval: "approved", approved_by: "Ada Lovelace" });
  });

  it("a repo with a map reads its own map's state: the map is the one read", () => {
    const t = ownMapRepo();
    expect(mapStatus(t).map((m) => m.map)).toEqual(["inb"]);
    expect(existsSync(join(t, "maps/inb/state.yaml"))).toBe(true);
    expect(existsSync(join(t, "status"))).toBe(false);
  });
});
