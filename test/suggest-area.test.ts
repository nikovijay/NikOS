// suggest in a planning repo: the company at the root, one area with --in or the folder you're in, and
// the MCP status tool and plan_init for the same. A code repo's menu never names the plan commands.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp/server";
import { runSuggest, suggest } from "../src/commands/suggest";
import { init } from "../src/commands/init";
import { addArea } from "../src/plan/repo";
import { acmePlan } from "./plan-serve-fixture";

/** runSuggest with its output captured. */
function capture(args: string[]) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const code = runSuggest(args);
  const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
  const err = error.mock.calls.map((c) => c.join(" ")).join("\n");
  log.mockRestore();
  error.mockRestore();
  return { code, out, err };
}

describe("suggest in a planning repo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("answers for the company at the root, and for one area with --in or in its folder", () => {
    const plan = acmePlan();
    expect(suggest(plan).summary).toBe("Acme (2027): 1 key result, 1 bet");
    const finance = "Finance (departments/finance): 1 key result, 1 bet";
    expect(suggest(plan, undefined, { area: "departments/finance" }).summary).toBe(finance);
    expect(suggest(plan, undefined, { area: "finance" }).summary).toBe(finance);
    expect(suggest(join(plan, "planning/departments/finance")).summary).toBe(finance);
    expect(capture(["--in", "finance", "--brief", "--dir", plan]).out).toContain(`nikOS: ${finance}.`);
  });

  it("says what an area's menu is for: the bets due for review, then the key results gone stale", () => {
    const plan = acmePlan();
    vi.setSystemTime(new Date("2027-03-01T12:00:00Z"));
    expect(suggest(plan).options.map((o) => o.label)).toEqual(["Review the one-inbox bet (due 2027-02-14)", 'Check in on "Revenue"', "Look at the plan"]);
    const finance = suggest(plan, undefined, { area: "finance" });
    expect(finance.options.map((o) => o.label)).toEqual(["Review the inbox-match bet (due 2027-02-14)", 'Check in on "Close days"', "Look at the plan"]);
    expect(finance.options[0].do).toContain("nikos plan bet review <id> <decision>");
    expect(finance.options[1].do).toContain("nikos plan checkin <kr-id> <value>");
  });

  it("asks a department with no key result to add one first, and a team has none to add", () => {
    const plan = acmePlan();
    addArea(plan, "department", "ops", { name: "Ops" });
    const ops = suggest(plan, undefined, { area: "ops" });
    expect(ops.summary).toBe("Ops (departments/ops): 0 key results, 0 bets");
    expect(ops.options.map((o) => o.label)).toEqual(["Add a key result", "Look at the plan"]);
    expect(ops.options[0].do).toContain("nikos plan kr new <id> --in departments/ops");
    const web = suggest(plan, undefined, { area: "WEB" });
    expect(web.summary).toBe("Checkout web (teams/WEB): 0 key results, 1 bet");
    expect(web.options.map((o) => o.label)).not.toContain("Add a key result");
  });

  it("names an area that doesn't exist, and says which there are", () => {
    const plan = acmePlan();
    const r = capture(["--in", "nowhere", "--dir", plan]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("There's no area called 'nowhere'. The areas are: company, departments/finance, groups/payments, teams/WEB");
  });

  it("the MCP status tool answers for the area it's given, and plan_init makes a planning repo", async () => {
    const plan = acmePlan();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await createServer(plan).connect(a);
    await client.connect(b);
    const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as any;
    const fin = await call("status", { area: "departments/finance" });
    expect(fin.isError).toBeFalsy();
    expect(fin.content[0].text.split("\n")[0]).toBe("Finance (departments/finance): 1 key result, 1 bet");
    expect((await call("status")).content[0].text.split("\n")[0]).toBe("Acme (2027): 1 key result, 1 bet");

    const empty = mkdtempSync(join(tmpdir(), "nikos-mcp-plan-"));
    const [c, d] = InMemoryTransport.createLinkedPair();
    const other = new Client({ name: "test", version: "1" });
    await createServer(empty).connect(c);
    await other.connect(d);
    const made = (await other.callTool({ name: "plan_init", arguments: { name: "Acme", year: "2027" } })) as any;
    expect(made.isError).toBeFalsy();
    expect(made.content[0].text).toContain("planning/company/plan.yaml");
    expect(existsSync(join(empty, "planning/company/plan.yaml"))).toBe(true);
  });

  it("a code repo's menu never names the plan commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-code-menu-"));
    init(dir, { name: "Tip Calc", key: "TC" });
    const s = suggest(dir);
    expect(JSON.stringify(s)).not.toMatch(/nikos plan|Check in on|bet review/);
  });
});
