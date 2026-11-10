import { writeMapSummary } from "../src/lib/map-summary";
import { featureFor } from "../src/commands/clear";
import { specHash } from "../src/lib/project";
import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { newBet, reviewBet, type BetInput } from "../src/planning/bets";
import { checkIn, isStale, newKr, reviseTarget } from "../src/planning/krs";
import { delivery, describeDelivery } from "../src/planning/delivery";
import { checkBet, checkKr, loadBet, loadKr, validatePlanning } from "../src/planning/model";
import { mkdirSync } from "node:fs";
import { copyExample, edit, rootOf } from "./helpers";

/** The bet and key result the hello-todo example carried, now written here, so the tests keep their subject. */
const BET_TEXT = `---
id: fewer-missed-tasks
owner: Product
team: Tasks
hypothesis: We believe showing only three tasks will make people miss fewer important ones, because testers said a long list hides what matters.
krs:
  primary: missed-important-tasks
  also: []
starts: 2026-10-05
review_on: 2026-12-01
confidence: medium
dependencies: []
outcome: open
reviews: []
---

## Why we think so
Seven of ten waitlist testers said they lose important tasks in long lists.
`;
const KR_TEXT = `id: missed-important-tasks
title: Testers who missed an important task last week
objective: focus
owner: Product
unit: "%"
baseline: 70
target: 35
original_target: 35
by: 2026-12-15
checkins:
  - date: 2026-10-12
    value: 70
    note: Baseline from the first survey.
  - date: 2026-11-02
    value: 55
    note: After the top-three view shipped to testers.
`;

/** A copy of the hello-todo story map, with its bet and key result in a planning/ folder of their own. */
const repo = () => {
  const root = rootOf(copyExample());
  mkdirSync(join(root, "planning/bets"), { recursive: true });
  mkdirSync(join(root, "planning/krs"), { recursive: true });
  writeFileSync(join(root, "planning/bets/fewer-missed-tasks.md"), BET_TEXT);
  writeFileSync(join(root, "planning/krs/missed-important-tasks.yaml"), KR_TEXT);
  return root;
};const bet: BetInput = { id: "faster-checkout", owner: "Checkout team", hypothesis: "We believe a one-page checkout will lift completion.", reviewOn: "2027-02-14", primary: "missed-important-tasks" };

describe("bet cards", () => {
  it("writes planning/bets/<id>.md and never overwrites", () => {
    const root = repo();
    expect(newBet(bet, root)).toBe("planning/bets/faster-checkout.md");
    const card = loadBet(root, "faster-checkout");
    expect(card.meta).toMatchObject({ id: "faster-checkout", owner: "Checkout team", review_on: "2027-02-14", outcome: "open", reviews: [], krs: { primary: "missed-important-tasks", also: [] } });
    expect(card.body).toContain("## Why we think so");
    edit(join(root, card.file), (s) => s.replace("The evidence behind the hypothesis", "Exit survey"));
    expect(() => newBet(bet, root)).toThrow("already exists");
    expect(readFileSync(join(root, card.file), "utf8")).toContain("Exit survey");
    expect(() => newBet({ ...bet, id: "x2", reviewOn: "soon" }, root)).toThrow("review date");
    expect(() => newBet({ ...bet, id: "x3", owner: " " }, root)).toThrow("owner");
    expect(validatePlanning(root)).toEqual([]);
  });

  it("validate rejects a stories field and unknown outcomes", () => {
    const base = { id: "a", owner: "o", hypothesis: "h", krs: {}, review_on: "2027-01-01", confidence: "low", dependencies: [], outcome: "open", reviews: [] };
    expect(checkBet(base)).toBe(true); // no key results: fine for maintenance or risk work
    expect(checkBet({ ...base, krs: { primary: "k", also: ["acme/plan#kr-2"] } })).toBe(true);
    expect(checkBet({ ...base, stories: ["HT-1"] })).toBe(false);
    for (const o of ["open", "awaiting evidence", "won", "lost", "stopped"]) expect(checkBet({ ...base, outcome: o }), o).toBe(true);
    expect(checkBet({ ...base, outcome: "killed" })).toBe(false);
    const root = repo();
    newBet(bet, root);
    edit(join(root, "planning/bets/faster-checkout.md"), (s) => s.replace("outcome: open", "outcome: shipped\nstories: [HT-1]"));
    const msgs = validatePlanning(root).map((i) => i.message);
    expect(msgs).toContain("unknown field 'stories'");
    expect(msgs.some((m) => m.startsWith("outcome must be one of"))).toBe(true);
  });
});

describe("delivery", () => {
  // A status change is written to the map's delivery summary too, as nikos state set does. A done
  // story is recorded against its feature, so its proof is current.
  const setStatus = (root: string, id: string, status: string) => {
    const hash = specHash(readFileSync(featureFor(id, root, "ht")!, "utf8"));
    edit(join(root, "maps/ht/state.yaml"), (s) => s.replace(new RegExp(`(${id}:\\n    status: )\\w+`), `$1${status}${status === "done" ? `\n    spec_hash: ${hash}` : ""}`));
    writeMapSummary(root, join(root, "maps/ht"));
  };

  it("shipped when all stories are done", () => {
    const root = repo();
    // The map's bet is on every story in it, so all three must be done.
    setStatus(root, "HT-1", "done");
    setStatus(root, "HT-2", "done");
    setStatus(root, "HT-3", "done");
    const d = delivery(root, "fewer-missed-tasks");
    expect(d).toMatchObject({ status: "Shipped", done: 3, total: 3, releases: [1, 2] });
    expect(loadBet(root, "fewer-missed-tasks").meta.outcome).toBe("open"); // the outcome stays as recorded
  });

  it("building with a count", () => {
    const d = delivery(repo(), "fewer-missed-tasks");
    expect(d).toMatchObject({ status: "Building", done: 0, total: 3 });
    // HT-1 is done in the example with no proof recorded against its feature, so it's counted as not current.
    expect(describeDelivery(d)).toBe("Building, 0 of 3 done, 1 not current with its feature");
  });

  it("not started when nothing names it", () => {
    const root = repo();
    newBet(bet, root);
    expect(delivery(root, "faster-checkout")).toMatchObject({ status: "Not started", total: 0 });
  });
});

describe("key results", () => {
  const kr = { id: "completion", title: "Checkout completion", owner: "Checkout team", baseline: 40, target: 55, by: "2027-03-31", unit: "%" };

  it("a check-in is added and earlier ones are unchanged", () => {
    const root = repo();
    expect(newKr(kr, root)).toBe("planning/krs/completion.yaml");
    checkIn(root, "completion", { value: 42, note: "week 1", date: "2027-01-10" });
    const before = loadKr(root, "completion").data.checkins;
    checkIn(root, "completion", { value: 45, evidence: "https://example.com/d", date: "2027-01-17" });
    const after = loadKr(root, "completion").data.checkins;
    expect(after.slice(0, 1)).toEqual(before);
    expect(after[1]).toEqual({ date: "2027-01-17", value: 45, evidence: "https://example.com/d" });
    expect(() => checkIn(root, "completion", { value: NaN })).toThrow("numeric");
  });

  it("revising a target keeps the original", () => {
    const root = repo();
    newKr(kr, root);
    reviseTarget(root, "completion", 50);
    const data = parse(readFileSync(join(root, "planning/krs/completion.yaml"), "utf8"));
    expect(data).toMatchObject({ target: 50, original_target: 55 });
    reviseTarget(root, "completion", 52);
    expect(loadKr(root, "completion").data).toMatchObject({ target: 52, original_target: 55 });
  });

  it("flags a stale result", () => {
    const k = { checkins: [{ date: "2027-01-01", value: 1 }], stale_after_days: 7 };
    expect(isStale(k, "2027-01-08")).toBe(false);
    expect(isStale(k, "2027-01-09")).toBe(true);
    expect(isStale({ checkins: [{ date: "2027-01-01", value: 1 }] }, "2027-01-14")).toBe(false); // default 14 days
    expect(isStale({ checkins: [] }, "2027-01-01")).toBe(true);
  });
});

describe("reviews", () => {
  it("adds a dated review and keeps earlier ones", () => {
    const root = repo();
    newBet(bet, root);
    reviewBet(root, "faster-checkout", { decision: "continue", reason: "Early numbers look right.", date: "2027-02-14" });
    const first = loadBet(root, "faster-checkout").meta.reviews;
    reviewBet(root, "faster-checkout", { decision: "change", reason: "Move the review out a month.", date: "2027-03-01" });
    const meta = loadBet(root, "faster-checkout").meta;
    expect(meta.reviews.slice(0, 1)).toEqual(first);
    expect(meta.reviews[1]).toEqual({ date: "2027-03-01", decision: "change", reason: "Move the review out a month." });
    expect(meta.outcome).toBe("open");
    expect(() => reviewBet(root, "faster-checkout", { decision: "continue", reason: " " })).toThrow("reason");
  });

  it("stop sets the outcome", () => {
    const root = repo();
    newBet(bet, root);
    reviewBet(root, "faster-checkout", { decision: "continue", reason: "Keep going.", date: "2027-02-14" });
    reviewBet(root, "faster-checkout", { decision: "stop", reason: "No movement after a month.", date: "2027-03-14" });
    const meta = loadBet(root, "faster-checkout").meta;
    expect(meta.outcome).toBe("stopped");
    expect(meta.reviews).toHaveLength(2);
    expect(meta.reviews[1]).toMatchObject({ decision: "stop", outcome: "stopped" });
  });

  it("complete asks for won or lost", () => {
    const root = repo();
    newBet(bet, root);
    expect(() => reviewBet(root, "faster-checkout", { decision: "complete", reason: "Done." })).toThrow("--outcome won or --outcome lost");
    reviewBet(root, "faster-checkout", { decision: "complete", reason: "Hit 56%.", outcome: "won", date: "2027-03-31" });
    expect(loadBet(root, "faster-checkout").meta).toMatchObject({ outcome: "won" });
  });
});

describe("planning files", () => {
  it("a stale write is refused", () => {
    const root = repo();
    newKr({ id: "k", title: "t", owner: "o", baseline: 0, target: 1, by: "2027-01-01" }, root);
    const loaded = loadKr(root, "k");
    writeFileSync(join(root, loaded.file), readFileSync(join(root, loaded.file), "utf8") + "# edited\n");
    expect(() => checkIn(root, "k", { value: 1, expect: loaded.hash })).toThrow("changed on disk");
  });

  it("accepts aligns_to as one reference or a list in the schemas", () => {
    const k = { id: "a", title: "a", owner: "o", baseline: 0, target: 1, by: "2027-01-01", original_target: 2, checkins: [] };
    expect(checkKr({ ...k, aligns_to: "acme/company-plan#kr-1" })).toBe(true);
    expect(checkKr({ ...k, aligns_to: ["acme/company-plan#kr-1", "acme/company-plan#kr-2"] })).toBe(true);
    expect(checkKr({ ...k, aligns_to: [] })).toBe(false);
    const b = { id: "b", owner: "o", hypothesis: "h", krs: {}, review_on: "2027-01-01", confidence: "low", dependencies: [], outcome: "open", reviews: [] };
    expect(checkBet({ ...b, aligns_to: ["acme/company-plan#one-tap-pay"] })).toBe(true);
    expect(checkBet({ ...b, aligns_to: ["../escape#x"] })).toBe(false);
  });
});
