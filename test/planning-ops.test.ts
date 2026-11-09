// Every change goes through runOp: the level, the ids, the command's own refusals, and the stale
// check. Each op here has a success, the refusals it can give (verbatim), and its wrong level.
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runMapNew, newMap } from "../src/commands/map";
import { runOp, runOps } from "../src/planning/ops";
import { newBet } from "../src/planning/bets";
import { newKr, checkIn } from "../src/planning/krs";
import { hash, loadBet, loadKr } from "../src/planning/model";
import { sync } from "../src/planning/upstream";
import { specHash } from "../src/lib/project";
import { commitAll, companyRepo, departmentRepo, git, groupRepo, readText, teamRepo, write } from "./planning-fixture";

afterEach(() => vi.restoreAllMocks());

const kr1 = (co: string) => hash(readText(co, "planning/krs/kr-1.yaml"));

describe("runOp: names, levels and ids", () => {
  it("refuses an op nikOS doesn't know", () => {
    const co = companyRepo();
    expect(() => runOp(co, { op: "bet.delete" as any, args: {} })).toThrow("'bet.delete' isn't a change nikOS knows");
  });

  it("refuses an op at the wrong level, with the level it's for", () => {
    const co = companyRepo();
    expect(() => runOp(co, { op: "story.rename", target: { story: "HT-1" }, args: { title: "x" } })).toThrow("story.rename isn't a change the company plan makes here");
  });

  it("refuses key results and check-ins at group level, with the key result rule's message", () => {
    const g = groupRepo("PAY");
    expect(() => runOp(g, { op: "checkin", target: { kr: "missed-tasks" }, args: { value: 1 } })).toThrow(/Key results stop at department level/);
    expect(() => runOp(g, { op: "kr.new", target: { kr: "pay-1" }, args: {} })).toThrow(/Key results stop at department level/);
  });

  it("checks the id of each target by its kind before the command runs", () => {
    const co = companyRepo();
    expect(() => runOp(co, { op: "kr.edit", target: { kr: "../../etc" }, args: { title: "x" }, expect: kr1(co) })).toThrow(
      "'../../etc' is not a key result id (lowercase words joined by hyphens)",
    );
    const g = groupRepo("PAY");
    expect(() => runOp(g, { op: "story.rename", target: { story: "pay-chk-1" }, args: { title: "x", map: "chk" } })).toThrow("'pay-chk-1' is not a story id");
  });

  it("refuses every op in a team repo with the group-repo message", () => {
    const t = teamRepo();
    expect(() => runOp(t, { op: "checkin", target: { kr: "kr-1" }, args: { value: 1 } })).toThrow("this is a team repo: changes are made in the group repo");
  });
});

describe("kr ops", () => {
  it("kr.edit: refuses an empty title, and a field it can't edit", () => {
    const co = companyRepo();
    expect(() => runOp(co, { op: "kr.edit", target: { kr: "kr-1" }, args: { title: "" }, expect: kr1(co) })).toThrow("A key result needs a title (--title)");
    expect(() => runOp(co, { op: "kr.edit", target: { kr: "kr-1" }, args: { baseline: 3 }, expect: kr1(co) })).toThrow("'baseline' can't be edited here");
  });

  it("kr.edit: writes the new title under planning/, and refuses a stale expect", () => {
    const co = companyRepo();
    const r = runOp(co, { op: "kr.edit", target: { kr: "kr-1" }, args: { title: "Grow paid revenue", unit: "" }, expect: kr1(co) });
    expect(loadKr(co, "kr-1").data.title).toBe("Grow paid revenue");
    expect(loadKr(co, "kr-1").data.unit).toBeUndefined();
    expect(r.changed).toEqual(["planning/krs/kr-1.yaml"]);
    expect(() => runOp(co, { op: "kr.edit", target: { kr: "kr-1" }, args: { title: "again" }, expect: "0000000000000000" })).toThrow(/changed on disk since it was loaded/);
  });

  it("kr.target: moves the target and keeps the original", () => {
    const co = companyRepo();
    runOp(co, { op: "kr.target", target: { kr: "kr-1" }, args: { target: 3 }, expect: kr1(co) });
    expect(loadKr(co, "kr-1").data).toMatchObject({ target: 3, original_target: 2 });
    expect(() => runOp(co, { op: "kr.target", target: { kr: "kr-1" }, args: { target: "many" }, expect: kr1(co) })).toThrow("A target needs a numeric value");
  });

  it("kr.align (department): refuses a plan that isn't directly above, and a bet", () => {
    const co = companyRepo();
    newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01" }, co);
    commitAll(co, "bet");
    const dept = departmentRepo(co);
    newKr({ id: "pay-1", title: "Checkout conversion", owner: "Payments", baseline: 50, target: 60, by: "2027-03-31" }, dept);
    expect(() => runOp(dept, { op: "kr.align", target: { kr: "pay-1" }, args: { aligns_to: ["acme/other#kr-1"] }, expect: hash(readText(dept, "planning/krs/pay-1.yaml")) })).toThrow(
      "acme/other#kr-1: acme/other isn't a plan this department joins (planning/upstream.yaml lists acme/company-plan)",
    );
    expect(() => runOp(dept, { op: "kr.align", target: { kr: "pay-1" }, args: { aligns_to: ["acme/company-plan#faster"] }, expect: hash(readText(dept, "planning/krs/pay-1.yaml")) })).toThrow(
      "acme/company-plan#faster is a bet: a key result aligns to key results",
    );
    runOp(dept, { op: "kr.align", target: { kr: "pay-1" }, args: { aligns_to: ["acme/company-plan#kr-1"] }, expect: hash(readText(dept, "planning/krs/pay-1.yaml")) });
    expect(loadKr(dept, "pay-1").data.aligns_to).toBe("acme/company-plan#kr-1");
  });
});

describe("bet ops", () => {
  it("bet.align (group): refuses a key result, which a bet can't align to", () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    newKr({ id: "pay-1", title: "Checkout conversion", owner: "Payments", baseline: 50, target: 60, by: "2027-03-31" }, dept);
    commitAll(dept, "pay-1");
    const g = groupRepo("PAY");
    write(join(g, "planning/upstream.yaml"), `- repo: acme/payments-plan\n  url: ${dept}\n`);
    git(g, "add", ".");
    git(g, "commit", "-q", "-m", "upstream");
    sync(g);
    expect(() => runOp(g, { op: "bet.align", target: { bet: "faster-checkout" }, args: { aligns_to: ["acme/payments-plan#pay-1"] }, expect: hash(readText(g, "planning/bets/faster-checkout.md")) })).toThrow(
      "acme/payments-plan#pay-1 is a key result: a bet aligns to bets, and names key results under krs",
    );
  });

  it("bet.krs (department): refuses a key result that isn't there, and one both primary and also", () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    newKr({ id: "pay-1", title: "Checkout conversion", owner: "Payments", baseline: 50, target: 60, by: "2027-03-31" }, dept);
    newBet({ id: "faster", owner: "Payments", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01" }, dept);
    const h = hash(readText(dept, "planning/bets/faster.md"));
    expect(() => runOp(dept, { op: "bet.krs", target: { bet: "faster" }, args: { primary: "nope" }, expect: h })).toThrow(
      "No key result called 'nope' (planning/krs/nope.yaml)",
    );
    expect(() => runOp(dept, { op: "bet.krs", target: { bet: "faster" }, args: { primary: "pay-1", also: ["pay-1"] }, expect: h })).toThrow("pay-1 is both primary and also");
    runOp(dept, { op: "bet.krs", target: { bet: "faster" }, args: { primary: "pay-1" }, expect: h });
    expect(loadBet(dept, "faster").meta.krs.primary).toBe("pay-1");
  });

  it("bet.krs is allowed at company level: the RFC's company row lists which key results a bet aims at", () => {
    const co = companyRepo();
    newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01" }, co);
    runOp(co, { op: "bet.krs", target: { bet: "faster" }, args: { primary: "kr-1" }, expect: hash(readText(co, "planning/bets/faster.md")) });
    expect(loadBet(co, "faster").meta.krs.primary).toBe("kr-1");
  });

  it("bet.edit: refuses outcome (only a review sets it); a review writes the review", () => {
    const co = companyRepo();
    newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01" }, co);
    const h = hash(readText(co, "planning/bets/faster.md"));
    expect(() => runOp(co, { op: "bet.edit", target: { bet: "faster" }, args: { outcome: "won" }, expect: h })).toThrow("'outcome' can't be edited here");
    expect(() => runOp(co, { op: "bet.review", target: { bet: "faster" }, args: { decision: "complete", reason: "Done" }, expect: h })).toThrow(
      "Completing a bet needs its outcome from the key result evidence: --outcome won or --outcome lost",
    );
    const r = runOp(co, { op: "bet.review", target: { bet: "faster" }, args: { decision: "continue", reason: "On track" }, expect: h });
    expect(r.changed).toEqual(["planning/bets/faster.md"]);
    expect(loadBet(co, "faster").meta.reviews.at(-1)).toMatchObject({ decision: "continue", reason: "On track" });
  });

  it("bet.align (department): aligns a bet to a bet above", () => {
    const co = companyRepo();
    newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01" }, co);
    commitAll(co, "bet");
    const dept = departmentRepo(co);
    newBet({ id: "one-tap", owner: "Payments", hypothesis: "One tap lifts conversion", reviewOn: "2027-02-14" }, dept);
    runOp(dept, { op: "bet.align", target: { bet: "one-tap" }, args: { aligns_to: ["acme/company-plan#faster"] }, expect: hash(readText(dept, "planning/bets/one-tap.md")) });
    expect(loadBet(dept, "one-tap").meta.aligns_to).toBe("acme/company-plan#faster");
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
    expect(() => newMap({ key: "X" }, g)).toThrow("nikos map new needs --bet <bet-id>");
    expect(() => newMap({ bet: "faster-checkout" }, g)).toThrow("nikos map new needs --key <KEY>");
    expect(() => newMap({ bet: "Bad Bet", key: "X" }, g)).toThrow("'Bad Bet' is not a bet id");
    expect(() => newMap({ bet: "nope", key: "ZZ" }, g)).toThrow("no planning/bets/nope.md: create it with nikos planning bet new");
    expect(() => newMap({ bet: "faster-checkout", key: "zz" }, g)).toThrow("map key must be uppercase letters and digits, up to 10 (e.g. CHK)");
    expect(() => newMap({ bet: "faster-checkout", key: "CHK" }, g)).toThrow("map key CHK is already used by maps/chk");
  });

  it("map.new refuses a repo that isn't a group plan", () => {
    const co = companyRepo();
    newBet({ id: "faster", owner: "Board", hypothesis: "Faster checkout pays", reviewOn: "2027-02-01" }, co);
    expect(() => newMap({ bet: "faster", key: "ZZ" }, co)).toThrow("planning/plan.yaml is not a group plan");
  });

  it("the command line prints the same line as before", () => {
    const g = groupRepo("PAY");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runMapNew(["--bet", "faster-checkout", "--key", "PAY", "--dir", g])).toBe(0);
    expect(log.mock.calls).toEqual([["Created maps/pay for bet faster-checkout, story ids PAY-PAY-n"]]);
    expect(existsSync(join(g, "maps/pay/storymap.yaml"))).toBe(true);
  });
});

describe("settings and downstream ops", () => {
  it("setting.set refuses a key a plan above locked", () => {
    const co = companyRepo();
    write(join(co, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked: [approval.policy]\n");
    commitAll(co, "settings");
    const dept = departmentRepo(co);
    expect(() => runOp(dept, { op: "setting.set", args: { key: "approval.policy", value: "off" } })).toThrow(
      "approval.policy is locked by acme/company-plan, so it can't be changed here",
    );
  });

  it("downstream.add lists a department below the plan", () => {
    const co = companyRepo();
    const r = runOp(co, { op: "downstream.add", args: { name: "Checkout", repo: "acme/checkout-web" } });
    expect(r.message).toBe("Added Checkout");
    expect(readText(co, "planning/downstream.yaml")).toContain("acme/checkout-web");
  });
});

describe("cleanup", () => {
  it("leaves no scratch folder behind after a dry run", () => {
    const co = companyRepo();
    runOps(co, [{ op: "kr.edit", target: { kr: "kr-1" }, args: { title: "x" }, expect: kr1(co) }]);
    expect(existsSync(join(co, ".nikos", "downstream"))).toBe(false);
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

  it("a downstream.add in a dry run changes nothing on disk, and its change set lists downstream.yaml", () => {
    const co = companyRepo();
    const before = existsSync(join(co, "planning", "downstream.yaml")) ? readText(co, "planning/downstream.yaml") : undefined;
    const dry = runOps(co, [{ op: "downstream.add", args: { name: "Payments" } }]);
    expect(dry.results[0].ok).toBe(true);
    expect(dry.changes.get("planning/downstream.yaml")).toContain("Payments");
    expect(existsSync(join(co, "planning", "downstream.yaml")) ? readText(co, "planning/downstream.yaml") : undefined).toBe(before);
  });
});
