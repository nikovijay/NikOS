// Delivery on bets: a bet's own figures from the maps that name it, the bets below it through aligns_to
// when it has no maps, and each copy's read age. Most cases are pure (deliveriesFrom); the last ones read
// real planning and code repos through refresh, with no network.
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliveriesFrom, planDeliveries, type CachedMap, type CachedRepo, type PlanBet } from "../src/plan/delivery";
import { refreshDelivery } from "../src/plan/refresh";
import { initPlanRepo } from "../src/plan/repo";
import { commitAll, groupRepo, write } from "./repo-fixture";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const TODAY = "2026-11-10T08:00:00.000Z";
const THREE_DAYS_AGO = "2026-11-07T08:00:00.000Z";
const SELF = "acme/company-plan";
const NOW_ISO_NEWER = "2026-11-10T12:00:00.000Z";

/** A storymap whose stories name bets: story id -> bet names. */
const storymap = (links: Record<string, string[]>, extra: Record<string, unknown> = {}) => ({
  format_version: 1,
  key: "CHK",
  releases: [{ number: 1, title: "First", stories: Object.keys(links) }],
  story_bets: links,
  ...extra,
});

const row = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, status, approval: "none", read_at: TODAY, ...extra });

const map = (key: string, storymapData: unknown, stories?: unknown[], problems: string[] = []): CachedMap => ({
  key,
  storymap: storymapData,
  ...(stories ? { summary: { version: 1, map: key, read_at: TODAY, stories: stories as any } } : {}),
  problems,
});

const repo = (name: string, maps: CachedMap[], extra: Partial<CachedRepo> = {}): CachedRepo => ({
  repo: name,
  host: "github.com",
  state: "ok",
  read_at: TODAY,
  maps,
  ...extra,
});

const bet = (id: string, aligns: string[] = []): PlanBet => ({ id, aligns });

const run = (bets: PlanBet[], repos: CachedRepo[], self: string | undefined = SELF) => deliveriesFrom({ self, cached: true, bets, repos, now: NOW });

describe("a bet's own delivery", () => {
  it("counts done, approved, in progress, not current and stories no summary lists, and leaves out cancelled ones", () => {
    const sm = storymap({ "PAY-CHK-1": ["faster-checkout"], "PAY-CHK-2": ["faster-checkout"], "PAY-CHK-3": ["faster-checkout"], "PAY-CHK-4": ["faster-checkout"], "PAY-CHK-5": ["faster-checkout"] });
    const stories = [
      row("PAY-CHK-1", "done", { approval: "approved", approved_by: "Ada" }),
      row("PAY-CHK-2", "in_progress"),
      row("PAY-CHK-3", "done", { proof: "changed" }),
      row("PAY-CHK-4", "cancelled"),
    ];
    const out = run([bet("faster-checkout")], [repo("acme/payments-web", [map("chk", sm, stories)])]);
    const d = out.bets.get("faster-checkout")!;
    expect(d.source).toBe("own");
    expect(d.delivery).toMatchObject({ status: "Building", total: 4, done: 1, approved: 1, inProgress: 1, notCurrent: 1, noSummary: 1 });
    expect(d.delivery!.maps).toEqual([{ host: "github.com", repo: "acme/payments-web", key: "chk" }]);
  });

  it("is Shipped when every counted story is done, and Not started when none is", () => {
    const sm = storymap({ "PAY-CHK-1": ["shipped-bet"], "PAY-CHK-2": ["waiting-bet"] });
    const stories = [row("PAY-CHK-1", "done"), row("PAY-CHK-2", "todo")];
    const out = run([bet("shipped-bet"), bet("waiting-bet")], [repo("acme/payments-web", [map("chk", sm, stories)])]);
    expect(out.bets.get("shipped-bet")!.delivery!.status).toBe("Shipped");
    expect(out.bets.get("waiting-bet")!.delivery!.status).toBe("Not started");
  });

  it("counts a bet once per map, even when the map names it in two stories, and keeps a bet whose stories are all cancelled as having maps", () => {
    const sm = storymap({ "PAY-CHK-1": ["faster-checkout"], "PAY-CHK-2": ["faster-checkout"] });
    const stories = [row("PAY-CHK-1", "cancelled"), row("PAY-CHK-2", "cancelled")];
    const out = run([bet("faster-checkout")], [repo("acme/payments-web", [map("chk", sm, stories)])]);
    const d = out.bets.get("faster-checkout")!;
    expect(d.source).toBe("own");
    expect(d.delivery).toMatchObject({ status: "Not started", total: 0, maps: [expect.objectContaining({ key: "chk" })] });
    expect(d.delivery!.maps).toHaveLength(1);
  });

  it("counts every story as to do, with no summary, when a map has no delivery.yaml", () => {
    const sm = storymap({ "PAY-CHK-1": ["faster-checkout"], "PAY-CHK-2": ["faster-checkout"] });
    const out = run([bet("faster-checkout")], [repo("acme/payments-web", [map("chk", sm)])]);
    expect(out.bets.get("faster-checkout")!.delivery).toMatchObject({ status: "Not started", total: 2, noSummary: 2 });
  });

  it("still counts the other maps when one map's delivery.yaml is from a newer nikOS, and says which", () => {
    const sm1 = storymap({ "PAY-CHK-1": ["faster-checkout"], "PAY-CHK-2": ["faster-checkout"] });
    const sm2 = storymap({ "PAY-CHK-3": ["faster-checkout"] });
    const repos = [
      repo("acme/payments-web", [
        map("chk", sm1, undefined, ["this delivery.yaml was written by a newer nikOS: upgrade nikos in the planning repo"]),
        map("ord", sm2, [row("PAY-CHK-3", "done")]),
      ]),
    ];
    const out = run([bet("faster-checkout")], repos);
    const d = out.bets.get("faster-checkout")!.delivery!;
    expect(d).toMatchObject({ status: "Building", total: 3, done: 1, noSummary: 2 });
    expect(d.maps.map((m) => m.key)).toEqual(["chk", "ord"]);
    expect(out.warnings).toEqual([
      { repo: "acme/payments-web", map: "chk", message: "this delivery.yaml was written by a newer nikOS: upgrade nikos in the planning repo" },
    ]);
  });
});

describe("a map that names its bet as a whole", () => {
  it("counts a map with no stories yet for its bet, so the bet has maps of its own", () => {
    const sm = { format_version: 1, key: "CHK", bet: "faster-checkout", releases: [{ number: 1, title: "First", stories: [] }] };
    const out = run([bet("faster-checkout")], [repo("acme/payments-web", [map("chk", sm, [])])]);
    expect(out.bets.get("faster-checkout")).toMatchObject({ source: "own", delivery: { status: "Not started", total: 0, maps: [expect.objectContaining({ key: "chk" })] } });
    expect(out.warnings).toEqual([]);
  });

  it("warns about a misspelt map-level bet, and counts nothing for it", () => {
    const sm = { format_version: 1, key: "CHK", bet: "faster-chekout", releases: [{ number: 1, title: "First", stories: [] }] };
    const out = run([bet("faster-checkout")], [repo("acme/payments-web", [map("chk", sm)])]);
    expect(out.bets.get("faster-checkout")).toMatchObject({ source: "none" });
    expect(out.warnings).toEqual([{ repo: "acme/payments-web", map: "chk", message: "faster-chekout: no bet called faster-chekout in this planning repo" }]);
  });
});

describe("delivery via aligns_to", () => {
  it("shows a bet with no maps of its own the bets below it, walking aligns_to through three levels", () => {
    const sm = storymap({ "PAY-CHK-1": ["leaf-bet"] });
    const bets = [bet("top-bet"), bet("middle-bet", ["top-bet"]), bet("leaf-bet", ["middle-bet"])];
    const out = run(bets, [repo("acme/payments-web", [map("chk", sm, [row("PAY-CHK-1", "done")])])]);
    expect(out.bets.get("leaf-bet")).toMatchObject({ source: "own" });
    expect(out.bets.get("middle-bet")).toMatchObject({ source: "via", via: [{ bet: "leaf-bet", delivery: { status: "Shipped", total: 1 } }] });
    expect(out.bets.get("top-bet")).toMatchObject({ source: "via", via: [{ bet: "leaf-bet" }] });
    expect(out.bets.get("top-bet")!.delivery).toBeUndefined();
  });

  it("lists each bet below separately, with its own figures, and never adds them together", () => {
    const sm = storymap({ "PAY-CHK-1": ["bet-a"], "PAY-CHK-2": ["bet-b"] });
    const stories = [row("PAY-CHK-1", "done"), row("PAY-CHK-2", "in_progress")];
    const bets = [bet("top-bet"), bet("bet-a", ["top-bet"]), bet("bet-b", ["top-bet"])];
    const out = run(bets, [repo("acme/payments-web", [map("chk", sm, stories)])]);
    const top = out.bets.get("top-bet")!;
    expect(top.via.map((v) => v.bet)).toEqual(["bet-a", "bet-b"]);
    expect(top.via[0].delivery).toMatchObject({ status: "Shipped", total: 1, done: 1 });
    expect(top.via[1].delivery).toMatchObject({ status: "Building", total: 1, inProgress: 1 });
    expect(top.delivery).toBeUndefined();
  });

  it("counts a map that feeds two bets below once for each bet", () => {
    const sm = storymap({ "PAY-CHK-1": ["bet-a"], "PAY-CHK-2": ["bet-b"] });
    const bets = [bet("top-bet"), bet("bet-a", ["top-bet"]), bet("bet-b", ["top-bet"])];
    const out = run(bets, [repo("acme/payments-web", [map("chk", sm, [row("PAY-CHK-1", "done"), row("PAY-CHK-2", "done")])])]);
    const via = out.bets.get("top-bet")!.via;
    expect(via).toHaveLength(2);
    expect(via.map((v) => v.delivery.maps.length)).toEqual([1, 1]);
    expect(via.map((v) => v.delivery.total)).toEqual([1, 1]);
  });

  it("ends a cycle in aligns_to, and a bet that aligns to itself, without looping", () => {
    const sm = storymap({ "PAY-CHK-1": ["bet-b"] });
    const bets = [bet("bet-a", ["bet-b"]), bet("bet-b", ["bet-a"]), bet("loop-bet", ["loop-bet"])];
    const out = run(bets, [repo("acme/payments-web", [map("chk", sm, [row("PAY-CHK-1", "done")])])]);
    expect(out.bets.get("bet-a")).toMatchObject({ source: "via", via: [{ bet: "bet-b" }] });
    expect(out.bets.get("bet-b")).toMatchObject({ source: "own" });
    expect(out.bets.get("loop-bet")).toMatchObject({ source: "none", via: [] });
  });

  it("ignores a bet link to another plan, so a story naming it doesn't count here", () => {
    const sm = storymap({ "PAY-CHK-1": ["acme/other-plan#faster-checkout"] }, {});
    const out = run([bet("faster-checkout")], [repo("acme/payments-web", [map("chk", sm, [row("PAY-CHK-1", "done")])])]);
    expect(out.bets.get("faster-checkout")).toMatchObject({ source: "none", via: [], reads: [] });
    expect(out.warnings).toEqual([{ repo: "acme/payments-web", map: "chk", message: "acme/other-plan#faster-checkout names a bet in another plan, so it isn't counted here" }]);
  });

  it("reads a bet link in this plan's own repo, written in full, as the bet", () => {
    const sm = storymap({ "PAY-CHK-1": ["acme/company-plan#faster-checkout"] });
    const out = run([bet("faster-checkout")], [repo("acme/payments-web", [map("chk", sm, [row("PAY-CHK-1", "done")])])]);
    expect(out.bets.get("faster-checkout")!.delivery).toMatchObject({ status: "Shipped", total: 1 });
    expect(out.warnings).toEqual([]);
  });

  it("warns about a bet link that names no bet in the plan, and doesn't count it", () => {
    const sm = storymap({ "PAY-CHK-1": ["one-tap-pay"] });
    const out = run([bet("faster-checkout")], [repo("acme/payments-web", [map("chk", sm, [row("PAY-CHK-1", "done")])])]);
    expect(out.bets.get("faster-checkout")).toMatchObject({ source: "none" });
    expect(out.warnings).toEqual([expect.objectContaining({ map: "chk", message: "one-tap-pay: no bet called one-tap-pay in this planning repo" })]);
  });
});

describe("read ages", () => {
  it("says how old each copy is: today, days ago, and what a failed read kept or failed on", () => {
    const sm = storymap({ "PAY-CHK-1": ["faster-checkout"] });
    const repos = [
      repo("acme/today-web", [map("chk", sm, [row("PAY-CHK-1", "done")])], { read_at: TODAY }),
      repo("acme/older-web", [map("chk", sm, [row("PAY-CHK-1", "done")])], { read_at: THREE_DAYS_AGO }),
      repo("acme/kept-web", [map("chk", sm, [row("PAY-CHK-1", "done")])], { state: "unreachable", read_at: THREE_DAYS_AGO, reason: "fatal: repository not found" }),
      repo("acme/never-web", [], { state: "unreachable", read_at: undefined, reason: "fatal: no such host" }),
    ];
    const out = run([bet("faster-checkout")], repos);
    expect(out.repos.map((r) => r.age)).toEqual([
      "read today (2026-11-10)",
      "read 3 days ago (2026-11-07)",
      "read 3 days ago (2026-11-07); the last read failed: fatal: repository not found",
      "could not be read: fatal: no such host",
    ]);
    // The bet's own reads list only the copies its figures come from, with the same wording.
    expect(out.bets.get("faster-checkout")!.reads.map((r) => r.repo)).toEqual(["acme/today-web", "acme/older-web", "acme/kept-web"]);
  });
});

describe("planDeliveries over a planning repo and its copies", () => {
  const NOW_ISO = "2026-11-10T12:00:00.000Z";

  it("reads nothing, and says so, when plan refresh has never run", () => {
    const plan = mkdtempSync(join(tmpdir(), "nikos-delivery-empty-"));
    initPlanRepo(plan, { name: "Acme", year: "2027" });
    write(join(plan, "planning/company/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
    const out = planDeliveries(plan, new Date(NOW_ISO));
    expect(out.cached).toBe(false);
    expect(out.repos).toEqual([]);
    expect(out.bets.get("faster-checkout")).toMatchObject({ source: "none", via: [], reads: [] });
  });

  it("works out a bet's figures and the bets above it from the copy plan refresh kept", () => {
    const code = groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-delivery-code-")));
    // The map's own summary: one story approved and done, one in progress, the third not listed yet.
    write(
      join(code, "maps/chk/delivery.yaml"),
      [
        "version: 1",
        "map: chk",
        `read_at: "${TODAY}"`,
        "stories:",
        "  - id: PAY-CHK-1",
        "    status: done",
        "    approval: approved",
        "    approved_by: Ada",
        `    read_at: "${TODAY}"`,
        "  - id: PAY-CHK-2",
        "    status: in_progress",
        "    approval: none",
        `    read_at: "${TODAY}"`,
        "",
      ].join("\n"),
    );
    commitAll(code, "summary");

    const plan = mkdtempSync(join(tmpdir(), "nikos-delivery-plan-"));
    initPlanRepo(plan, { name: "Acme", year: "2027" });
    write(join(plan, "planning/company/bets/checkout-goal.md"), "---\nid: checkout-goal\n---\n");
    write(join(plan, "planning/company/bets/faster-checkout.md"), "---\nid: faster-checkout\naligns_to: checkout-goal\n---\n");
    write(join(plan, "planning/repos.yaml"), `version: 1\nrepos:\n  - repo: acme/payments-web\n    host: github.com\n    url: "${code}"\n`);
    refreshDelivery(plan, { now: new Date(NOW_ISO) });

    const out = planDeliveries(plan, new Date(NOW_ISO));
    expect(out.cached).toBe(true);
    expect(out.repos).toEqual([expect.objectContaining({ repo: "acme/payments-web", state: "ok", age: "read today (2026-11-10)" })]);
    expect(out.bets.get("faster-checkout")!.delivery).toMatchObject({ status: "Building", total: 3, done: 1, approved: 1, inProgress: 1, noSummary: 1 });
    expect(out.bets.get("checkout-goal")).toMatchObject({ source: "via", via: [{ bet: "faster-checkout" }] });
    expect(out.warnings).toEqual([]);
  });
});

describe("a copy written by a newer nikOS, read for real", () => {
  it("refuses a newer delivery.yaml and a newer storymap.yaml, and still counts the maps that read", () => {
    const code = groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-delivery-newer-code-")));
    // chk: a good storymap, but a delivery.yaml from a newer nikOS. ord: a storymap from a newer nikOS.
    write(join(code, "maps/chk/storymap.yaml"), "format_version: 1\nkey: CHK\nreleases:\n  - number: 1\n    title: First\n    stories: [PAY-CHK-1]\nstory_bets:\n  PAY-CHK-1: [faster-checkout]\n");
    write(join(code, "maps/chk/delivery.yaml"), `version: 2\nmap: chk\nread_at: "${TODAY}"\nstories: []\n`);
    write(join(code, "maps/ord/storymap.yaml"), "format_version: 2\nkey: ORD\nreleases:\n  - number: 1\n    title: First\n    stories: [PAY-ORD-1]\nstory_bets:\n  PAY-ORD-1: [faster-checkout]\n");
    commitAll(code, "maps");

    const plan = mkdtempSync(join(tmpdir(), "nikos-delivery-newer-plan-"));
    initPlanRepo(plan, { name: "Acme", year: "2027" });
    write(join(plan, "planning/company/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
    write(join(plan, "planning/repos.yaml"), `version: 1\nrepos:\n  - repo: acme/payments-web\n    host: github.com\n    url: "${code}"\n`);
    refreshDelivery(plan, { now: new Date(NOW_ISO_NEWER) });

    const out = planDeliveries(plan, new Date(NOW_ISO_NEWER));
    expect(out.bets.get("faster-checkout")!.delivery).toMatchObject({ status: "Not started", total: 1, noSummary: 1, maps: [expect.objectContaining({ key: "chk" })] });
    const messages = out.warnings.map((w) => `${w.map}: ${w.message}`);
    expect(messages).toEqual(expect.arrayContaining([
      "chk: this delivery.yaml was written by a newer nikOS: upgrade nikos in the planning repo",
      "ord: this storymap.yaml was written by a newer nikOS: upgrade nikos in the planning repo",
    ]));
    expect(out.warnings).toHaveLength(2);
  });
});

describe("the stories behind each bet", () => {
  it("lists each story a bet's maps name, with its status, approval and proof, and none for a bet with no maps", () => {
    const sm = storymap({ "PAY-CHK-1": ["faster-checkout"], "PAY-CHK-2": ["faster-checkout"], "PAY-CHK-3": ["faster-checkout"] });
    const stories = [row("PAY-CHK-1", "done", { approval: "approved" }), row("PAY-CHK-2", "in_progress", { proof: "changed" })];
    const out = run([bet("faster-checkout"), bet("unmapped")], [repo("acme/payments-web", [map("chk", sm, stories)])]);
    expect(out.stories.get("faster-checkout")).toEqual([
      { id: "PAY-CHK-1", map: { host: "github.com", repo: "acme/payments-web", key: "chk" }, status: "done", approval: "approved" },
      { id: "PAY-CHK-2", map: { host: "github.com", repo: "acme/payments-web", key: "chk" }, status: "in_progress", approval: "none", proof: "changed" },
      { id: "PAY-CHK-3", map: { host: "github.com", repo: "acme/payments-web", key: "chk" }, status: null, approval: "none" },
    ]);
    expect(out.stories.get("unmapped")).toEqual([]);
  });

  it("gives a bet with no maps of its own the stories of the bets below it", () => {
    const sm = storymap({ "PAY-CHK-1": ["leaf-bet"] });
    const out = run([bet("top-bet"), bet("leaf-bet", ["top-bet"])], [repo("acme/payments-web", [map("chk", sm, [row("PAY-CHK-1", "done")])])]);
    expect(out.stories.get("top-bet")).toEqual([expect.objectContaining({ id: "PAY-CHK-1", status: "done" })]);
  });
});
