// suggest, and the MCP status tool, on a company plan with no story map and on a group with several
// maps: the menu an agent offers must work there, not point at setup or fail asking for --map.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp/server";
import { runSuggest, suggest } from "../src/commands/suggest";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { addDownstream } from "../src/planning/rollout";
import { companyRepo } from "./planning-fixture";
import { commitAll, groupRepo } from "./team-fixture";

const brief = (dir: string) => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  runSuggest(["--brief", "--dir", dir]);
  const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
  log.mockRestore();
  return out;
};

/** The payments group with a second map, hr, so nothing can pick a map for you. */
function twoMaps(): string {
  const group = groupRepo("PAY");
  newMap({ bet: "faster-checkout", key: "HR" }, group);
  newStory({ title: "Show a line to a reviewer", activity: "getting-started", map: "hr" }, group);
  commitAll(group, "a second map");
  return group;
}

describe("suggest on plans and groups", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("a company plan with no story map gets its plan's menu, not setup", () => {
    const company = companyRepo();
    addDownstream(company, { name: "Payments", repo: "acme/payments-plan" });
    const s = suggest(company);
    expect(s.summary).toBe("Acme plan (Q1 2027): 1 key result, 0 bets");
    const labels = s.options.map((o) => o.label);
    expect(labels).not.toContain("Set up nikOS here");
    expect(labels).toEqual(expect.arrayContaining(["See how the plans below are doing", "Look at the plan"]));
    expect(s.options.find((o) => o.label === "See how the plans below are doing")?.do).toContain("nikos planning rollout");
    // The session-start line shows for a plan too.
    expect(brief(company)).toContain("nikOS: Acme plan (Q1 2027): 1 key result, 0 bets. Suggested next:");
  });

  it("a group with several maps gets each map's progress without --map, and one map's menu with it", () => {
    const group = twoMaps();
    const all = suggest(group);
    expect(all.summary).toBe("2 story maps: chk 0 of 3 done · hr 0 of 1 done");
    expect(all.options.map((o) => o.label)).toContain("Pick a story map to work on (chk, hr)");
    const one = suggest(group, "HR");
    expect(one.summary).toContain("0 of 1 done");
    expect(one.options.map((o) => o.label)).toContain("Build PAY-HR-1: Show a line to a reviewer");
  });

  it("the MCP status tool takes a map, and without one shows each map", async () => {
    const group = twoMaps();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await createServer(group).connect(a);
    await client.connect(b);
    const call = async (args: Record<string, unknown> = {}) => (await client.callTool({ name: "status", arguments: args })) as any;
    const all = await call();
    expect(all.isError).toBeFalsy();
    expect(all.content[0].text.split("\n")[0]).toBe("2 story maps: chk 0 of 3 done · hr 0 of 1 done");
    const hr = await call({ map: "hr" });
    expect(hr.isError).toBeFalsy();
    expect(hr.content[0].text).toContain("Build PAY-HR-1: Show a line to a reviewer");
  });
});
