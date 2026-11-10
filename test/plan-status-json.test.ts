// nikos plan status shows each bet's delivery and how old each copy is, in text and with --json, and
// plan validate and status warn about bet links that name nothing here and repos never read. Real local
// repos, no network; the copies come from refresh.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initPlanRepo } from "../src/plan/repo";
import { refreshDelivery } from "../src/plan/refresh";
import { runPlanRepo } from "../src/plan/cli";
import { commitAll, git, groupRepo, write } from "./repo-fixture";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const TODAY = "read today (2026-11-10)";

async function run(args: string[]): Promise<{ code: number; out: string }> {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const err = vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.join(" ")));
  try {
    return { code: await runPlanRepo(args), out: out.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

/** A code repo whose one map names bets through story_bets; each story is listed in the given storymap. */
function codeWith(links: Record<string, string[]>, summary: string): string {
  const code = groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-status-code-")));
  const stories = Object.keys(links);
  write(
    join(code, "maps/chk/storymap.yaml"),
    [
      "format_version: 1",
      "project: chk",
      "key: CHK",
      "activities:",
      "  - id: pay",
      "    title: Pay",
      "releases:",
      "  - number: 1",
      "    title: First",
      `    stories: [${stories.join(", ")}]`,
      "story_bets:",
      ...stories.map((s) => `  ${s}: [${links[s].join(", ")}]`),
      "",
    ].join("\n"),
  );
  write(join(code, "maps/chk/delivery.yaml"), summary);
  commitAll(code, "map");
  return code;
}

const SUMMARY = [
  "version: 1",
  "map: chk",
  `read_at: "${NOW.toISOString()}"`,
  "stories:",
  "  - id: PAY-CHK-1",
  "    status: done",
  "    approval: approved",
  "    approved_by: Ada",
  `    read_at: "${NOW.toISOString()}"`,
  "  - id: PAY-CHK-2",
  "    status: in_progress",
  "    approval: none",
  `    read_at: "${NOW.toISOString()}"`,
  "",
].join("\n");

describe("nikos plan status: delivery on each bet", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  async function planAndCopy(code: string, listed: string[] = ["acme/payments-web"]) {
    const plan = mkdtempSync(join(tmpdir(), "nikos-status-plan-"));
    initPlanRepo(plan, { name: "Acme", year: "2027" });
    expect((await run(["bet", "new", "checkout-goal", "--in", "company", "--owner", "Sam", "--hypothesis", "H", "--review", "2027-02-15", "--dir", plan])).code).toBe(0);
    expect((await run(["add", "department", "payments", "--name", "Payments", "--dir", plan])).code).toBe(0);
    expect((await run(["bet", "new", "faster-checkout", "--in", "departments/payments", "--owner", "Sam", "--hypothesis", "H", "--review", "2027-02-15", "--aligns-to", "checkout-goal", "--dir", plan])).code).toBe(0);
    const entries = listed.map((r) => `  - repo: ${r}\n    url: "${code}"\n`).join("");
    write(join(plan, "planning/repos.yaml"), `version: 1\nrepos:\n${entries}`);
    refreshDelivery(plan, { now: NOW });
    return plan;
  }

  it("shows each bet's own figures with the copy's age, and a bet above it as via the bet below", async () => {
    const code = codeWith({ "PAY-CHK-1": ["faster-checkout"], "PAY-CHK-2": ["faster-checkout"] }, SUMMARY);
    const plan = await planAndCopy(code);
    const out = (await run(["status", "--dir", plan])).out;
    expect(out).toContain(`Code repo acme/payments-web: ${TODAY}`);
    expect(out).toContain(`    delivery: Building, 1 of 2 done (1 approved), 1 in progress · acme/payments-web: ${TODAY}`);
    expect(out).toContain(`    delivery via faster-checkout: Building, 1 of 2 done (1 approved), 1 in progress · acme/payments-web: ${TODAY}`);
  });

  it("gives the same figures with --json, with each repo's read time, and --json doesn't swallow --in", async () => {
    const code = codeWith({ "PAY-CHK-1": ["faster-checkout"], "PAY-CHK-2": ["faster-checkout"] }, SUMMARY);
    const plan = await planAndCopy(code);
    const { code: exit, out } = await run(["status", "--json", "--in", "departments/payments", "--dir", plan]);
    expect(exit).toBe(0);
    const data = JSON.parse(out);
    expect(data.repos).toEqual([expect.objectContaining({ repo: "acme/payments-web", host: "github.com", state: "ok", read_at: NOW.toISOString(), age: TODAY })]);
    expect(data.areas.map((a: any) => a.rel)).toEqual(["departments/payments"]);
    const bet = data.areas[0].bets[0];
    expect(bet).toMatchObject({ id: "faster-checkout", aimsAt: [], alignsTo: ["checkout-goal"] });
    expect(bet.delivery).toMatchObject({ source: "own", delivery: { status: "Building", total: 2, done: 1, approved: 1, inProgress: 1 } });
    expect(bet.delivery.reads).toEqual([expect.objectContaining({ repo: "acme/payments-web", age: TODAY })]);
    expect(data.warnings).toEqual([]);
  });

  it("with --json and no --in, lists every area, and the bet above shows the bet below", async () => {
    const code = codeWith({ "PAY-CHK-1": ["faster-checkout"], "PAY-CHK-2": ["faster-checkout"] }, SUMMARY);
    const plan = await planAndCopy(code);
    const data = JSON.parse((await run(["status", "--json", "--dir", plan])).out);
    expect(data.areas.map((a: any) => a.rel)).toEqual(["company", "departments/payments"]);
    const top = data.areas[0].bets[0];
    expect(top).toMatchObject({ id: "checkout-goal", delivery: { source: "via", via: [{ bet: "faster-checkout" }] } });
    expect(top.delivery.delivery).toBeUndefined();
  });
});

describe("nikos plan status and validate: warnings about delivery", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("warns about a map's bet links that name no bet of this plan, or a bet elsewhere, and validate still passes", async () => {
    const code = codeWith({ "PAY-CHK-1": ["faster-checkout"], "PAY-CHK-2": ["one-tap-pay"], "PAY-CHK-3": ["acme/other-plan#faster-checkout"] }, SUMMARY);
    const plan = mkdtempSync(join(tmpdir(), "nikos-status-warn-"));
    initPlanRepo(plan, { name: "Acme", year: "2027" });
    // The plan's own name comes from its origin, so a link to this plan can be told from one to another.
    git(plan, "init", "-q", "-b", "main");
    git(plan, "remote", "add", "origin", "https://github.com/acme/company-plan.git");
    expect((await run(["bet", "new", "faster-checkout", "--in", "company", "--owner", "Sam", "--hypothesis", "H", "--review", "2027-02-15", "--dir", plan])).code).toBe(0);
    write(join(plan, "planning/repos.yaml"), `version: 1\nrepos:\n  - repo: acme/payments-web\n    url: "${code}"\n`);
    refreshDelivery(plan, { now: NOW });

    const validate = await run(["validate", "--dir", plan]);
    expect(validate.code).toBe(0);
    expect(validate.out).toContain("! acme/payments-web maps/chk: one-tap-pay: no bet called one-tap-pay in this planning repo");
    expect(validate.out).toContain("! acme/payments-web maps/chk: acme/other-plan#faster-checkout names a bet in another plan, so it isn't counted here");
    expect(validate.out).toContain("✓ The plan for 2027 is valid");

    const status = await run(["status", "--dir", plan]);
    expect(status.out).toContain("! acme/payments-web maps/chk: one-tap-pay: no bet called one-tap-pay in this planning repo");
    const data = JSON.parse((await run(["status", "--json", "--dir", plan])).out);
    expect(data.warnings.map((w: any) => w.message)).toContain("one-tap-pay: no bet called one-tap-pay in this planning repo");
  });

  it("says when no code repo is listed, and no delivery has been read yet, without a warning when nothing is listed", async () => {
    const plan = mkdtempSync(join(tmpdir(), "nikos-status-none-"));
    initPlanRepo(plan, { name: "Acme", year: "2027" });
    expect((await run(["bet", "new", "faster-checkout", "--in", "company", "--owner", "Sam", "--hypothesis", "H", "--review", "2027-02-15", "--dir", plan])).code).toBe(0);
    expect((await run(["status", "--dir", plan])).out).toContain("    delivery: no code repos listed yet in planning/repos.yaml");
    expect((await run(["validate", "--dir", plan])).out).not.toContain("! ");

    write(join(plan, "planning/repos.yaml"), "version: 1\nrepos:\n  - repo: acme/payments-web\n    url: \"/nowhere\"\n");
    expect((await run(["status", "--dir", plan])).out).toContain("    delivery: no read yet: run nikos plan refresh");
    const validate = await run(["validate", "--dir", plan]);
    expect(validate.code).toBe(0);
    expect(validate.out).toContain("! planning/repos.yaml: no code repo has been read yet: run nikos plan refresh");
  });

  it("warns about a repo listed after the last refresh, and says a repo whose read failed could not be read", async () => {
    const code = codeWith({ "PAY-CHK-1": ["faster-checkout"] }, SUMMARY);
    const plan = mkdtempSync(join(tmpdir(), "nikos-status-late-"));
    initPlanRepo(plan, { name: "Acme", year: "2027" });
    expect((await run(["bet", "new", "faster-checkout", "--in", "company", "--owner", "Sam", "--hypothesis", "H", "--review", "2027-02-15", "--dir", plan])).code).toBe(0);
    write(join(plan, "planning/repos.yaml"), `version: 1\nrepos:\n  - repo: acme/payments-web\n    url: "${code}"\n  - repo: acme/broken-web\n    url: "/nowhere/at/all"\n`);
    refreshDelivery(plan, { now: NOW });
    expect((await run(["status", "--dir", plan])).out).toContain("Code repo acme/broken-web: could not be read");

    write(join(plan, "planning/repos.yaml"), `version: 1\nrepos:\n  - repo: acme/payments-web\n    url: "${code}"\n  - repo: acme/broken-web\n    url: "/nowhere/at/all"\n  - repo: acme/late-web\n    url: "${code}"\n`);
    const validate = await run(["validate", "--dir", plan]);
    expect(validate.code).toBe(0);
    expect(validate.out).toContain("! planning/repos.yaml: acme/late-web has never been read: run nikos plan refresh");
    expect(validate.out).not.toContain("acme/broken-web has never been read");
  });
});
