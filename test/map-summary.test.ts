// The pure summary a map's files say (lib/map-summary.ts): each story's status, approval and proof,
// in a fixed order, and the drift check that validate runs against a committed delivery.yaml.
import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { setState } from "../src/commands/state";
import { approve } from "../src/commands/approve";
import { summaryBody, summaryDrift, summaryWith, hasSummary, type SummaryBody } from "../src/lib/map-summary";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { groupRepo, git, write, commitAll, feature } from "./repo-fixture";

vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});

const byId = (b: SummaryBody, id: string) => b.stories.find((s) => s.id === id)!;

/** A group repo with its own map INB (PAY-INB-1 and -2), as nikos map new makes it. */
function ownMap(): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-summary-own-"));
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

describe("the summary a map's files say", () => {
  it("a story with no state is todo, and a map's summary names its owner and map", () => {
    const g = groupRepo("PAY");
    const b = summaryBody(g, join(g, "maps/chk"));
    expect(b).toEqual({
      format_version: 1,
      map: "chk",
      owner: "PAY",
      stories: [
        { id: "PAY-CHK-1", status: "todo", approval: "none" },
        { id: "PAY-CHK-2", status: "todo", approval: "none" },
        { id: "PAY-CHK-3", status: "todo", approval: "none" },
      ],
    });
  });

  it("a done story with an approval that holds is approved, with the approver's name", () => {
    const g = groupRepo("PAY");
    setState("PAY-CHK-1", "in_progress", { dir: g });
    setState("PAY-CHK-1", "done", { dir: g });
    approve("PAY-CHK-1", { dir: g, by: "Priya Shah", date: "2027-01-06" });
    expect(byId(summaryBody(g, join(g, "maps/chk")), "PAY-CHK-1")).toEqual({ id: "PAY-CHK-1", status: "done", approval: "approved", approved_by: "Priya Shah" });
  });

  it("a done story whose feature changed after its approval loses the approval", () => {
    const g = groupRepo("PAY");
    setState("PAY-CHK-1", "in_progress", { dir: g });
    setState("PAY-CHK-1", "done", { dir: g });
    approve("PAY-CHK-1", { dir: g, by: "Priya Shah", date: "2027-01-06" });
    const card = join(g, "maps/chk/features/pay/pay-by-card.feature");
    write(card, `${readFileSync(card, "utf8")}\n# reworded\n`);
    expect(byId(summaryBody(g, join(g, "maps/chk")), "PAY-CHK-1")).toEqual({ id: "PAY-CHK-1", status: "done", approval: "none", proof: "changed" });
  });

  it("a group's map judges proof the same way: a done story proved against an older feature is changed", () => {
    const g = groupRepo("PAY");
    setState("PAY-CHK-1", "in_progress", { dir: g });
    setState("PAY-CHK-1", "done", { dir: g });
    const card = join(g, "maps/chk/features/pay/pay-by-card.feature");
    write(card, `${readFileSync(card, "utf8")}\n# reworded\n`);
    expect(byId(summaryBody(g, join(g, "maps/chk")), "PAY-CHK-1")).toEqual({ id: "PAY-CHK-1", status: "done", approval: "none", proof: "changed" });
  });

  it("a map of its own: a done status with no spec hash is unverified, and one proved against an older feature is changed", () => {
    const t = ownMap();
    write(join(t, "maps/inb/state.yaml"), "format_version: 1\nstories:\n  PAY-INB-1: { status: done }\n  PAY-INB-2: { status: todo }\n");
    expect(byId(summaryBody(t, join(t, "maps/inb")), "PAY-INB-1")).toMatchObject({ status: "done", proof: "unverified" });
    setState("PAY-INB-2", "in_progress", { dir: t });
    commitAll(t, "start");
    setState("PAY-INB-2", "done", { dir: t });
    commitAll(t, "done");
    expect(byId(summaryBody(t, join(t, "maps/inb")), "PAY-INB-2")).toMatchObject({ status: "done" });
    expect(byId(summaryBody(t, join(t, "maps/inb")), "PAY-INB-2")).not.toHaveProperty("proof");
    const card = join(t, "maps/inb/features/getting-started/pay-by-wallet.feature");
    write(card, `${readFileSync(card, "utf8")}\n# reworded\n`);
    expect(byId(summaryBody(t, join(t, "maps/inb")), "PAY-INB-2")).toMatchObject({ status: "done", proof: "changed" });
  });

  it("a map of its own: an in-progress status written against an older feature is behind", () => {
    const t = ownMap();
    setState("PAY-INB-1", "in_progress", { dir: t });
    commitAll(t, "start");
    const card = join(t, "maps/inb/features/getting-started/pay-by-card.feature");
    write(card, `${readFileSync(card, "utf8")}\n# reworded\n`);
    expect(byId(summaryBody(t, join(t, "maps/inb")), "PAY-INB-1")).toMatchObject({ status: "in_progress", proof: "behind" });
  });

  it("stories in releases come in release order, and stories no release names come after them, sorted by id", () => {
    const g = groupRepo("PAY");
    write(join(g, "maps/chk/features/confirm/zeta.feature"), feature("PAY-CHK-9", "confirm", 2, "Zeta"));
    write(join(g, "maps/chk/features/confirm/alpha.feature"), feature("PAY-CHK-7", "confirm", 2, "Alpha"));
    expect(summaryBody(g, join(g, "maps/chk")).stories.map((s) => s.id)).toEqual(["PAY-CHK-1", "PAY-CHK-2", "PAY-CHK-3", "PAY-CHK-7", "PAY-CHK-9"]);
  });

  it("the same files give the same summary, whichever order they were written in", () => {
    const one = groupRepo("PAY");
    write(join(one, "maps/chk/features/confirm/zeta.feature"), feature("PAY-CHK-9", "confirm", 2, "Zeta"));
    write(join(one, "maps/chk/features/confirm/alpha.feature"), feature("PAY-CHK-7", "confirm", 2, "Alpha"));
    const two = groupRepo("PAY");
    write(join(two, "maps/chk/features/confirm/alpha.feature"), feature("PAY-CHK-7", "confirm", 2, "Alpha"));
    write(join(two, "maps/chk/features/confirm/zeta.feature"), feature("PAY-CHK-9", "confirm", 2, "Zeta"));
    expect(summaryBody(two, join(two, "maps/chk"))).toEqual(summaryBody(one, join(one, "maps/chk")));
  });

  it("a group with a map but no owner or key has no owner to write, and says so", () => {
    const g = groupRepo("PAY");
    write(join(g, "planning/plan.yaml"), "name: Checkout\nperiod: Q1 2027\nlevel: group\npillars: []\n");
    expect(() => summaryBody(g, join(g, "maps/chk"))).toThrow("this map has no owner");
  });

  it("a map gets a summary only in a repo's maps/ folder: intent/ gets none", () => {
    expect(hasSummary({ root: "/r", dir: "/r/intent", inRepo: false })).toBe(false);
    expect(hasSummary({ root: "/r", dir: "/r/maps/chk", id: "chk", inRepo: true })).toBe(true);
    expect(hasSummary({ root: "/r", dir: "/r/maps/inb", id: "inb", inRepo: true })).toBe(true);
  });
});

describe("the drift check against a committed delivery.yaml", () => {
  const body: SummaryBody = { format_version: 1, map: "chk", owner: "PAY", stories: [{ id: "PAY-CHK-1", status: "todo", approval: "none" }, { id: "PAY-CHK-2", status: "done", approval: "approved", approved_by: "Priya" }] };

  it("a file that says the same, with its own read_at and in any order, has no drift", () => {
    const onDisk = parse(JSON.stringify(summaryWith({ ...body, stories: [...body.stories].reverse() }, new Date("2027-01-01T00:00:00Z"))));
    expect(summaryDrift(body, onDisk)).toBeUndefined();
  });

  it("names the first story and field that differ", () => {
    const onDisk = { ...summaryWith(body, new Date()), stories: [{ ...summaryWith(body, new Date()).stories[0] }, { id: "PAY-CHK-2", status: "in_progress", approval: "none", read_at: "x" }] };
    expect(summaryDrift(body, onDisk)).toEqual({ file: "delivery.yaml", message: "PAY-CHK-2: status is 'in_progress' in delivery.yaml, but 'done' now" });
  });

  it("a story missing from the file, and a story the file has that the map doesn't, both drift", () => {
    const full = summaryWith(body, new Date());
    expect(summaryDrift(body, { ...full, stories: full.stories.slice(1) })?.message).toBe("PAY-CHK-1 is not in delivery.yaml");
    expect(summaryDrift(body, { ...full, stories: [...full.stories, { id: "PAY-CHK-9", status: "todo", approval: "none", read_at: "x" }] })?.message).toBe("PAY-CHK-9 is in delivery.yaml but not in the map");
  });

  it("a changed owner, map or format drifts too", () => {
    const full = summaryWith(body, new Date());
    expect(summaryDrift(body, { ...full, owner: "WEB" })?.message).toBe("owner is 'WEB' in delivery.yaml, but 'PAY' now");
    expect(summaryDrift(body, "not a summary")?.message).toBe("is not a delivery summary");
  });

  it("the summary's approval and proof are compared too", () => {
    const full = summaryWith(body, new Date());
    const stale = { ...full, stories: full.stories.map((s) => (s.id === "PAY-CHK-2" ? { ...s, approval: "none", approved_by: undefined } : s)) };
    expect(summaryDrift(body, stale)?.message).toBe("PAY-CHK-2: approval is 'none' in delivery.yaml, but 'approved' now");
  });
});
