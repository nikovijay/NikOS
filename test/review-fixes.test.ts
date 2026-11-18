// Regression coverage for the review of main at 960da01: the serve key, spec checks, and the plan gaps.
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { runActivity } from "../src/commands/step";
import { newMap } from "../src/commands/map";
import { toPrd } from "../src/commands/export";
import { storyMapOf } from "../src/commands/map";
import { validate } from "../src/commands/validate";
import { runPlanRepo, planIssues, planStatus } from "../src/plan/cli";
import { addArea, addObjective, findArea, initPlanRepo } from "../src/plan/repo";
import { describeErrors, checkKr } from "../src/planning/model";
import { isStale, newKr } from "../src/planning/krs";
import { newBet } from "../src/planning/bets";
import { writeLink } from "../src/plan/settings-link";
import { createServer } from "../src/mcp/server";
import { acmePlan } from "./plan-serve-fixture";
import { specHash } from "../src/lib/project";
import { commitAll, git, groupRepo, write } from "./repo-fixture";
import { copyExample } from "./helpers";

async function plan(repo: string, ...args: string[]) {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const err = vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.join(" ")));
  try {
    return { code: await runPlanRepo([...args, "--dir", repo]), out: out.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

describe("spec review fixes", () => {
  it("activity add prints the real map path and refuses a second add of the same id", () => {
    const root = copyExample();
    const out: string[] = [];
    const err: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    const error = vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
    try {
      expect(runActivity(["add", "Split the bill", "--dir", root])).toBe(0);
      expect(out.join("\n")).toContain("maps/ht/features/split-the-bill/");
      expect(out.join("\n")).not.toContain("the story map/");
      expect(runActivity(["add", "Split the bill", "--dir", root])).toBe(1);
      expect(err.join("\n")).toContain("already an activity 'split-the-bill'");
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("a duplicated story id in one map is not described as two maps, and does not warn that it changed after done", () => {
    const dir = groupRepo();
    const src = join(dir, "maps/chk/features/pay/pay-by-card.feature");
    const hash = specHash(readFileSync(src, "utf8"));
    write(join(dir, "maps/chk/features/pay/pay-by-card-again.feature"), readFileSync(src, "utf8").replace("Pay by card", "Pay by card again"));
    write(join(dir, "maps/chk/state.yaml"), `format_version: 1\nstories:\n  PAY-CHK-1: { status: done, spec_hash: ${hash}, updated: 2027-01-05 }\n  PAY-CHK-2: { status: todo }\n  PAY-CHK-3: { status: todo }\n`);
    const messages = [...validate(dir).errors, ...validate(dir).warnings].map((e) => e.message).join("\n");
    expect(messages).toContain("PAY-CHK-1 already has a feature file");
    expect(messages).not.toContain("is in two maps (maps/chk and maps/chk)");
    expect(messages).not.toContain("changed after it was done");
  });

  it("a PRD does not say Approved once the code has moved on from the tested commit", () => {
    const dir = groupRepo();
    write(join(dir, "src/pay.js"), "export const pay = 1;\n");
    commitAll(dir, "code");
    const tested = git(dir, "rev-parse", "HEAD");
    const feature = readFileSync(join(dir, "maps/chk/features/pay/pay-by-card.feature"), "utf8");
    write(join(dir, "maps/chk/state.yaml"), `format_version: 1\nstories:\n  PAY-CHK-1: { status: done, spec_hash: ${specHash(feature)}, done_at: '2027-01-05T00:00:00Z', updated: 2027-01-05, tested_commit: ${tested}, evidence: { commit: ${tested} } }\n  PAY-CHK-2: { status: todo }\n  PAY-CHK-3: { status: todo }\n`);
    write(join(dir, "maps/chk/approvals/PAY-CHK-1.yaml"), `by: Ada\non: 2027-01-06\nspec_hash: ${specHash(feature)}\ndone_at: '2027-01-05T00:00:00Z'\ntested_commit: ${tested}\n`);
    write(join(dir, "src/pay.js"), "export const pay = 2;\n");
    commitAll(dir, "code moved");
    const prd = toPrd(storyMapOf(dir, "chk"));
    expect(prd).toContain("Status: Done");
    expect(prd).toContain("the sign-off no longer covers this code");
    expect(prd).not.toContain("Status: Approved");
  });

  it("map new refuses a bet the plan snapshot does not list", () => {
    const dir = groupRepo();
    writeLink(dir, {
      format_version: 1,
      plan: { repo: "acme/company-plan" },
      read: { commit: "a".repeat(40), at: "2026-11-18T00:00:00Z" },
      company: [],
      owners: {},
      maps: { chk: "PAY" },
      bets: ["faster-checkout"],
      sha256: "",
    });
    expect(() => newMap({ bet: "ghost-bet", key: "ZZ" }, dir)).toThrow("isn't a bet in this repo's plan");
    expect(newMap({ bet: "faster-checkout", key: "ZZ" }, dir).id).toBe("zz");
  });
});

describe("plan review fixes", () => {
  it("names every missing field of a new key result and a new bet at once, and drops the else-schema line", () => {
    const repo = acmePlan();
    expect(() => newKr({ title: "", owner: "", baseline: Number.NaN, target: Number.NaN, by: "" }, findArea(repo, "finance").dir)).toThrow(/needs a title[\s\S]*needs an owner[\s\S]*starting number/);
    expect(() => newBet({ owner: "", hypothesis: "", reviewOn: "" }, findArea(repo, "finance").dir)).toThrow(/needs a title[\s\S]*needs an owner[\s\S]*needs a hypothesis[\s\S]*review date/);
    checkKr({ id: "x", title: "T", owner: "O", by: "2027-03-31", checkins: [] });
    expect(describeErrors(checkKr.errors).join("\n")).not.toContain('must match "else" schema');
    expect(describeErrors(checkKr.errors).join("\n")).toContain("baseline");
  });

  it("does not call a key result stale before its period starts or before the first check-in is due", () => {
    const kr = { period: "2027-Q1", baseline: 0, target: 10, checkins: [] as { date: string; value: number }[] };
    expect(isStale(kr, "2026-11-18")).toBe(false);
    expect(isStale(kr, "2027-01-10")).toBe(false);
    expect(isStale(kr, "2027-01-20")).toBe(true);
    expect(isStale({ ...kr, checkins: [{ date: "2027-01-10", value: 1 }] }, "2027-01-20")).toBe(false);
  });

  it("adds a squad, an objective and a pillar, and refuses a duplicate objective id", async () => {
    const repo = acmePlan();
    expect((await plan(repo, "add", "squad", "checkout", "--name", "Checkout", "--home", "WEB")).code).toBe(0);
    expect((await plan(repo, "pillar", "add", "Growth")).code).toBe(0);
    expect((await plan(repo, "pillar", "add", "Growth")).code).toBe(1);
    expect((await plan(repo, "objective", "add", "grow", "--in", "finance", "--title", "Grow")).code).toBe(0);
    expect(() => addObjective(repo, findArea(repo, "company"), { id: "grow", title: "Grow again" })).toThrow("already used");
    const planFile = join(repo, "planning/departments/finance/plan.yaml");
    writeFileSync(planFile, readFileSync(planFile, "utf8") + "  - id: grow\n    title: Again\n");
    expect(planIssues(repo).map((i) => i.message).join("\n")).toContain("'grow' is used twice");
    expect((await plan(repo, "kr", "new", "faster", "--in", "finance", "--title", "Faster", "--owner", "Mira", "--baseline", "1", "--target", "2", "--objective", "nope")).out).toContain("no objective 'nope'");
  });

  it("status for finance includes the payments bet aimed at its key result, and refresh with no repos says so", async () => {
    const repo = acmePlan();
    const status = planStatus(repo, findArea(repo, "finance"));
    expect(status).toContain("faster-checkout");
    expect(status).toContain("groups/payments");
    expect(status).not.toMatch(/Bets: none/);
    const empty = mkdtempSync(join(tmpdir(), "nikos-empty-plan-"));
    initPlanRepo(empty, { name: "Acme", year: "2027" });
    const refreshed = await plan(empty, "refresh");
    expect(refreshed.code).toBe(0);
    expect(refreshed.out).toContain("No code repos are listed yet");
  });

  it("the MCP server can add an area, an objective, a key result, a bet and a check-in, and read status", async () => {
    const repo = acmePlan();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await createServer(repo).connect(a);
    await client.connect(b);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ["plan_add_area", "plan_pillar_add", "plan_objective_add", "plan_kr_new", "plan_bet_new", "plan_checkin", "plan_status"]) {
      expect(names).toContain(name);
    }
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).content[0].text as string;
    expect(await call("plan_add_area", { level: "squad", id: "checkout", name: "Checkout", home: "WEB" })).toContain("squad.yaml");
    expect(await call("plan_objective_add", { id: "grow", title: "Grow", area: "finance" })).toContain("plan.yaml");
    expect(await call("plan_kr_new", { id: "faster", area: "finance", title: "Faster", owner: "Mira", baseline: 1, target: 2, objective: "grow", period: "2027-Q1" })).toContain("faster.yaml");
    expect(await call("plan_checkin", { id: "faster", value: 1.5, note: "started" })).toContain("faster.yaml");
    expect(await call("plan_bet_new", { id: "try-it", area: "checkout", title: "Try it", owner: "Ada", hypothesis: "It helps.", review: "2027-02-14", kr: "faster" })).toContain("try-it.md");
    expect(await call("plan_status", { area: "finance" })).toContain("faster");
  });
});
