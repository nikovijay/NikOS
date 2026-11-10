// Every change goes through runOp: the level, the ids, the command's own refusals, and the stale
// check. Each op here has a success, the refusals it can give (verbatim), and its wrong level.
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMapNew, newMap } from "../src/commands/map";
import { setState } from "../src/commands/state";
import { validate } from "../src/commands/validate";
import { runOp, runOps } from "../src/planning/ops";
import { newBet } from "../src/planning/bets";
import { newKr, checkIn } from "../src/planning/krs";
import { hash, loadBet, loadKr } from "../src/planning/model";
import { specHash } from "../src/lib/project";
import { commitAll, companyRepo, git, groupRepo, readText, write } from "./planning-fixture";

/** The company's area of a new planning repo: ops run on an area folder, and its paths are the repo's. */
const area = () => join(companyRepo(), "planning", "company");

afterEach(() => vi.restoreAllMocks());

const kr1 = (co: string) => hash(readText(co, "krs/kr-1.yaml"));

describe("runOp: names, levels and ids", () => {
  it("refuses an op nikOS doesn't know", () => {
    const co = area();
    expect(() => runOp(co, { op: "bet.delete" as any, args: {} })).toThrow("'bet.delete' isn't a change nikOS knows");
  });

  it("refuses an op at the wrong level, with the level it's for", () => {
    const co = area();
    expect(() => runOp(co, { op: "story.rename", target: { story: "HT-1" }, args: { title: "x" } })).toThrow("story.rename isn't a change a planning area makes: story maps and settings stay in the code repos");
  });

  it("checks the id of each target by its kind before the command runs", () => {
    const co = area();
    expect(() => runOp(co, { op: "kr.edit", target: { kr: "../../etc" }, args: { title: "x" }, expect: kr1(co) })).toThrow(
      "'../../etc' is not a key result id (lowercase words joined by hyphens)",
    );
    const g = groupRepo("PAY");
    expect(() => runOp(g, { op: "story.rename", target: { story: "pay-chk-1" }, args: { title: "x", map: "chk" } })).toThrow("'pay-chk-1' is not a story id");
  });

});

describe("kr ops", () => {
  it("kr.edit: refuses an empty title, and a field it can't edit", () => {
    const co = area();
    expect(() => runOp(co, { op: "kr.edit", target: { kr: "kr-1" }, args: { title: "" }, expect: kr1(co) })).toThrow("A key result needs a title (--title)");
    expect(() => runOp(co, { op: "kr.edit", target: { kr: "kr-1" }, args: { baseline: 3 }, expect: kr1(co) })).toThrow("'baseline' can't be edited here");
  });

  it("kr.edit: writes the new title under planning/, and refuses a stale expect", () => {
    const co = area();
    const r = runOp(co, { op: "kr.edit", target: { kr: "kr-1" }, args: { title: "Grow paid revenue", unit: "" }, expect: kr1(co) });
    expect(loadKr(co, "kr-1").data.title).toBe("Grow paid revenue");
    expect(loadKr(co, "kr-1").data.unit).toBeUndefined();
    expect(r.changed).toEqual(["planning/company/krs/kr-1.yaml"]);
    expect(() => runOp(co, { op: "kr.edit", target: { kr: "kr-1" }, args: { title: "again" }, expect: "0000000000000000" })).toThrow(/changed on disk since it was loaded/);
  });

  it("kr.target: moves the target and keeps the original", () => {
    const co = area();
    runOp(co, { op: "kr.target", target: { kr: "kr-1" }, args: { target: 3 }, expect: kr1(co) });
    expect(loadKr(co, "kr-1").data).toMatchObject({ target: 3, original_target: 2 });
    expect(() => runOp(co, { op: "kr.target", target: { kr: "kr-1" }, args: { target: "many" }, expect: kr1(co) })).toThrow("A target needs a numeric value");
  });

});

describe("bet ops", () => {
  it("bet.krs is allowed at company level: the RFC's company row lists which key results a bet aims at", () => {
    const co = area();
    newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01" }, co);
    runOp(co, { op: "bet.krs", target: { bet: "faster" }, args: { primary: "kr-1" }, expect: hash(readText(co, "bets/faster.md")) });
    expect(loadBet(co, "faster").meta.krs.primary).toBe("kr-1");
  });

  it("bet.edit: refuses outcome (only a review sets it); a review writes the review", () => {
    const co = area();
    newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01" }, co);
    const h = hash(readText(co, "bets/faster.md"));
    expect(() => runOp(co, { op: "bet.edit", target: { bet: "faster" }, args: { outcome: "won" }, expect: h })).toThrow("'outcome' can't be edited here");
    expect(() => runOp(co, { op: "bet.review", target: { bet: "faster" }, args: { decision: "complete", reason: "Done" }, expect: h })).toThrow(
      "Completing a bet needs its outcome from the key result evidence: --outcome won or --outcome lost",
    );
    const r = runOp(co, { op: "bet.review", target: { bet: "faster" }, args: { decision: "continue", reason: "On track" }, expect: h });
    expect(r.changed).toEqual(["planning/company/bets/faster.md"]);
    expect(loadBet(co, "faster").meta.reviews.at(-1)).toMatchObject({ decision: "continue", reason: "On track" });
  });

});

describe("story, activity, step and release ops", () => {
  it("story.rename: changes the Feature line, keeps the tags, and changes the spec hash", () => {
    const g = groupRepo("PAY");
    const path = "maps/chk/features/pay/pay-by-card.feature";
    const before = readText(g, path);
    const r = runOp(g, { op: "story.rename", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: "Pay by debit card" } });
    const after = readText(g, path);
    expect(after).toContain("Feature: Pay by debit card");
    expect(after.split("\n")[0]).toBe(before.split("\n")[0]);
    expect(specHash(after)).not.toBe(specHash(before));
    expect(r.message).toBe("Renamed PAY-CHK-1");
    expect(() => runOp(g, { op: "story.rename", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: " " } })).toThrow("A story needs a title");
  });

  it("story.remove: refuses a story with work done, and removes one that hasn't started", () => {
    const g = groupRepo("PAY");
    write(join(g, "maps/chk/state.yaml"), readFileSync(join(g, "maps/chk/state.yaml"), "utf8").replace("PAY-CHK-1: { status: todo }", "PAY-CHK-1: { status: done }"));
    expect(() => runOp(g, { op: "story.remove", target: { story: "PAY-CHK-1" }, args: { map: "chk" } })).toThrow("PAY-CHK-1 has work done");
    runOp(g, { op: "story.remove", target: { story: "PAY-CHK-3" }, args: { map: "chk" } });
    expect(existsSync(join(g, "maps/chk/features/confirm/see-receipt.feature"))).toBe(false);
    expect(readText(g, "maps/chk/storymap.yaml")).not.toContain("PAY-CHK-3");
    expect(readText(g, "maps/chk/state.yaml")).not.toContain("PAY-CHK-3");
  });

  it("story.rename and story.remove keep delivery.yaml current, so validate passes straight after them", () => {
    const g = groupRepo("PAY");
    const deliveryErrors = () => validate(g, "chk").errors.filter((e) => e.file === "delivery.yaml");
    // A story in progress has a proof, which a rename makes behind.
    setState("PAY-CHK-1", "in_progress", { dir: g });
    runOp(g, { op: "story.rename", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: "Pay by debit card" } });
    expect(deliveryErrors()).toEqual([]);
    runOp(g, { op: "story.remove", target: { story: "PAY-CHK-3" }, args: { map: "chk" } });
    expect(deliveryErrors()).toEqual([]);
  });

  it("activity.rename and step.rename: refuse an unknown id, and rename a known one", () => {
    const g = groupRepo("PAY");
    const h = hash(readText(g, "maps/chk/storymap.yaml"));
    expect(() => runOp(g, { op: "activity.rename", target: { activity: "nope" }, args: { map: "chk", title: "X" }, expect: h })).toThrow("nope is not an activity in maps/chk");
    expect(() => runOp(g, { op: "step.rename", target: { step: "nope" }, args: { map: "chk", title: "X" }, expect: h })).toThrow("nope is not a step in maps/chk");
    runOp(g, { op: "activity.rename", target: { activity: "pay" }, args: { map: "chk", title: "Pay now" }, expect: h });
    expect(readText(g, "maps/chk/storymap.yaml")).toContain("title: Pay now");
  });

  it("release.rename: refuses a blank title and leaves the file as it was; a title writes", () => {
    const g = groupRepo("PAY");
    const before = readText(g, "maps/chk/storymap.yaml");
    expect(() => runOp(g, { op: "release.rename", target: { release: "2" }, args: { map: "chk", title: "  " } })).toThrow("A release needs a title");
    expect(readText(g, "maps/chk/storymap.yaml")).toBe(before);
    const r = runOp(g, { op: "release.rename", target: { release: "2" }, args: { map: "chk", title: "Later" } });
    expect(r.changed).toEqual(["maps/chk/storymap.yaml"]);
  });

  it("strict: a write that the checks would fail is refused before anything is written", () => {
    const g = groupRepo("PAY");
    const before = readText(g, "maps/chk/storymap.yaml");
    expect(() => runOp(g, { op: "activity.new", args: { map: "chk", title: "Odd", id: "Bad Id" } }, { strict: true })).toThrow("activities.2.id 'Bad Id' is not in the expected format");
    expect(readText(g, "maps/chk/storymap.yaml")).toBe(before);
    // Without strict the CLI's own behaviour stands: the write is made, and validation reports it.
    runOp(g, { op: "activity.new", args: { map: "chk", title: "Odd", id: "Bad Id" } });
    expect(readText(g, "maps/chk/storymap.yaml")).toContain("Bad Id");
  });

  it("a dry run changes nothing on disk, and lists the file it would change", () => {
    const g = groupRepo("PAY");
    const before = readText(g, "maps/chk/storymap.yaml");
    const dry = runOps(g, [{ op: "release.rename", target: { release: "2" }, args: { map: "chk", title: "Later" }, expect: hash(before) }]);
    expect(dry.results[0].ok).toBe(true);
    expect(dry.changes.has("maps/chk/storymap.yaml")).toBe(true);
    expect(readText(g, "maps/chk/storymap.yaml")).toBe(before);
  });
});

describe("map ops", () => {
  it("map.new refuses in the order the command line checks, with the same messages", () => {
    const g = groupRepo("PAY");
    expect(() => newMap({ bet: "faster-checkout" }, g)).toThrow("nikos map new needs --key <KEY>");
    expect(() => newMap({ bet: "Bad Bet", key: "X" }, g)).toThrow("'Bad Bet' is not a bet id");
    expect(() => newMap({ bet: "acme/payments#faster", key: "ZZ" }, g)).toThrow("a map names one bet by its id, not another repo's bet");
    expect(() => newMap({ bet: "faster-checkout", key: "zz" }, g)).toThrow("map key must be uppercase letters and digits, up to 10 (e.g. CHK)");
    expect(() => newMap({ bet: "faster-checkout", key: "CHK" }, g)).toThrow("map key CHK is already used by maps/chk");
  });

  it("map.new works in a company plan too: no group plan is needed", () => {
    const co = area();
    newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01" }, co);
    expect(newMap({ bet: "faster", key: "ZZ" }, co).id).toBe("zz");
  });

  it("the command line prints the same line as before", () => {
    const g = groupRepo("PAY");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runMapNew(["--bet", "faster-checkout", "--key", "PAY", "--owner", "PAY", "--dir", g])).toBe(0);
    expect(log.mock.calls).toEqual([["Created maps/pay for bet faster-checkout, story ids PAY-PAY-n"]]);
    expect(existsSync(join(g, "maps/pay/storymap.yaml"))).toBe(true);
  });
});

describe("cleanup", () => {
  it("leaves the files as they were after a dry run", () => {
    const co = area();
    const before = kr1(co);
    runOps(co, [{ op: "kr.edit", target: { kr: "kr-1" }, args: { title: "x" }, expect: kr1(co) }]);
    expect(kr1(co)).toBe(before);
    rmSync(co, { recursive: true, force: true });
  });

  it("release.move is no longer an op: it's refused as a change nikOS doesn't know", () => {
    const g = groupRepo("PAY");
    expect(() => runOp(g, { op: "release.move" as any, target: { release: "2" }, args: { map: "chk", to: 1 } })).toThrow("'release.move' isn't a change nikOS knows");
  });

  it("a stale release op is refused with the file it was made against, and writes nothing", () => {
    const g = groupRepo("PAY");
    const before = readText(g, "maps/chk/storymap.yaml");
    expect(() => runOp(g, { op: "release.rename", target: { release: "2" }, args: { map: "chk", title: "Later" }, expect: "0000000000000000" })).toThrow("storymap.yaml changed on disk");
    expect(readText(g, "maps/chk/storymap.yaml")).toBe(before);
  });

  it("an argument the op doesn't read is refused, not dropped", () => {
    const g = groupRepo("PAY");
    expect(() => runOp(g, { op: "story.rename", target: { story: "PAY-CHK-1" }, args: { map: "chk", title: "Pay", titel: "Oops" } })).toThrow("'titel' isn't an argument of story.rename");
  });

});
