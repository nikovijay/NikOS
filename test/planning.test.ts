import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { newBet, reviewBet, type BetInput } from "../src/planning/bets";
import { checkIn, isStale, newKr, reviseTarget } from "../src/planning/krs";
import { delivery, describeDelivery } from "../src/planning/delivery";
import { checkBet, loadBet, loadKr, validatePlanning } from "../src/planning/model";
import { runPlanning } from "../src/planning/cli";
import { copyExample, edit } from "./helpers";

const repo = () => dirname(copyExample());
const bet: BetInput = { id: "faster-checkout", owner: "Checkout team", hypothesis: "We believe a one-page checkout will lift completion.", reviewOn: "2027-02-14", primary: "missed-important-tasks" };

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
  const setStatus = (root: string, id: string, status: string) => edit(join(root, "intent/state.yaml"), (s) => s.replace(new RegExp(`(${id}:\\n    status: )\\w+`), `$1${status}`));

  it("shipped when all stories are done", () => {
    const root = repo();
    setStatus(root, "HT-2", "done");
    const d = delivery(root, "fewer-missed-tasks");
    expect(d).toMatchObject({ status: "Shipped", done: 2, total: 2, releases: [1] });
    expect(loadBet(root, "fewer-missed-tasks").meta.outcome).toBe("open"); // the outcome stays as recorded
  });

  it("building with a count", () => {
    const d = delivery(repo(), "fewer-missed-tasks");
    expect(d).toMatchObject({ status: "Building", done: 1, total: 2 });
    expect(describeDelivery(d)).toBe("Building, 1 of 2 done");
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

describe("example", () => {
  it("hello-todo's planning folder is valid", () => {
    expect(validatePlanning(join(__dirname, "../examples/hello-todo"))).toEqual([]);
  });

  it("a stale write is refused", () => {
    const root = repo();
    newKr({ id: "k", title: "t", owner: "o", baseline: 0, target: 1, by: "2027-01-01" }, root);
    const loaded = loadKr(root, "k");
    writeFileSync(join(root, loaded.file), readFileSync(join(root, loaded.file), "utf8") + "# edited\n");
    expect(() => checkIn(root, "k", { value: 1, expect: loaded.hash })).toThrow("changed on disk");
  });
});

describe("planning validate", () => {
  it("counts one bet and one key result in the singular", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runPlanning(["validate", "--dir", join(__dirname, "../examples/hello-todo")]);
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    log.mockRestore();
    expect(code).toBe(0);
    expect(out).toContain("1 bet, 1 key result");
  });
});
