// The contract files a planning repo reads (delivery.yaml, storymap.yaml) are tolerant: unknown fields
// pass, and a version newer than this nikOS reads is refused by name. The writers stay strict.
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { validate } from "../src/commands/validate";
import { readDeliverySummaryResult, writeDeliverySummary, type DeliverySummary } from "../src/lib/delivery-summary";
import { contractProblems, contractVersion, NewerContractError, schemaProblems } from "../src/lib/schema";
import { groupRepo, write } from "./repo-fixture";
import { mapStatus, writeSummaries } from "../src/commands/map-status";

const NOW = new Date("2026-11-08T09:12:00Z");
const NEWER_PLANNING = "this delivery.yaml was written by a newer nikOS: upgrade nikos in the planning repo";

/** The committed delivery.yaml for the PAY group's CHK map, read back as data. */
function summaryOf(g: string): Record<string, unknown> {
  return parse(readFileSync(join(g, "maps/chk/delivery.yaml"), "utf8"));
}

/** Write the summary back as a file, after the test has changed it. */
function putSummary(g: string, data: Record<string, unknown>): void {
  write(join(g, "maps/chk/delivery.yaml"), stringify(data));
}

describe("the contract version helper", () => {
  it("version 1 and a missing version are not refused here (a missing one is the schema's problem)", () => {
    expect(contractVersion("delivery.yaml", { version: 1 }, "version", "planning")).toBeUndefined();
    expect(contractVersion("delivery.yaml", { map: "chk" }, "version", "planning")).toBeUndefined();
    expect(contractVersion("storymap.yaml", { format_version: 1 }, "format_version", "code")).toBeUndefined();
  });

  it("a version newer than 1 is refused, naming the file and the repo to upgrade", () => {
    expect(contractVersion("delivery.yaml", { version: 2 }, "version", "planning")).toBe(NEWER_PLANNING);
    expect(contractVersion("storymap.yaml", { format_version: 2 }, "format_version", "code")).toBe(
      "this storymap.yaml was written by a newer nikOS: upgrade nikos in the code repo",
    );
  });

  it("the refusal is a NewerContractError, so a reader can tell it from a bad file", () => {
    expect(() => contractProblems("delivery.yaml", { version: 2 }, "version", "planning", "contract/delivery.schema.json")).toThrow(NewerContractError);
    expect(() => contractProblems("delivery.yaml", { version: 2 }, "version", "planning", "contract/delivery.schema.json")).toThrow(NEWER_PLANNING);
  });

  it("a bad file is a list of problems, not an exception", () => {
    const problems = contractProblems("delivery.yaml", { map: "chk" }, "version", "planning", "contract/delivery.schema.json");
    expect(problems.join("\n")).toContain("missing required field 'version'");
  });
});

describe("delivery.yaml is read tolerantly by a planning repo", () => {
  it("a summary with unknown fields at the top and on a story reads", () => {
    const g = groupRepo("PAY");
    writeSummaries(g, mapStatus(g), NOW);
    const data = summaryOf(g);
    data.forecast = "soon";
    (data.stories as Record<string, unknown>[])[0].team = "checkout";
    putSummary(g, data);
    const read = readDeliverySummaryResult(join(g, "maps/chk"));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.summary.stories.map((s) => s.id)).toEqual(["PAY-CHK-1", "PAY-CHK-2", "PAY-CHK-3"]);
  });

  it("a summary with version: 2 is refused with the newer-nikOS message, and is not read as missing", () => {
    const g = groupRepo("PAY");
    writeSummaries(g, mapStatus(g), NOW);
    const data = summaryOf(g);
    data.version = 2;
    putSummary(g, data);
    expect(readDeliverySummaryResult(join(g, "maps/chk"))).toEqual({ ok: false, reason: NEWER_PLANNING, newer: true });
  });
});

describe("storymap.yaml is read tolerantly by a planning repo", () => {
  it("unknown fields pass the tolerant reader", () => {
    const data = { format_version: 1, key: "CHK", bet: "faster-checkout", owner: "PAY", project: "chk", activities: [], releases: [], forecast: "soon" };
    expect(contractProblems("storymap.yaml", data, "format_version", "planning", "contract/storymap.schema.json")).toEqual([]);
  });

  it("format_version: 2 is refused by the tolerant reader, under its own field name", () => {
    expect(() => contractProblems("storymap.yaml", { format_version: 2, key: "CHK" }, "format_version", "planning", "contract/storymap.schema.json")).toThrow(
      "this storymap.yaml was written by a newer nikOS: upgrade nikos in the planning repo",
    );
  });

  it("the tolerant reader still needs a key, and a bet in the right shape", () => {
    expect(contractProblems("storymap.yaml", { format_version: 1 }, "format_version", "planning", "contract/storymap.schema.json").join("\n")).toContain(
      "missing required field 'key'",
    );
    expect(contractProblems("storymap.yaml", { key: "CHK", bet: "Not A Bet" }, "format_version", "planning", "contract/storymap.schema.json").join("\n")).toContain(
      "bet",
    );
  });
});

describe("the writers stay strict", () => {
  it("writeDeliverySummary still rejects an unknown field", () => {
    const g = groupRepo("PAY");
    const summary = { version: 1, map: "chk", read_at: "2026-11-08T09:12:00Z", stories: [], forecast: "soon" } as unknown as DeliverySummary;
    expect(() => writeDeliverySummary(join(g, "maps/chk"), summary)).toThrow(/unknown field 'forecast'/);
  });

  it("the writer schema for delivery.yaml names version, not format_version", () => {
    expect(schemaProblems("delivery-summary.schema.json", { format_version: 1, map: "chk", read_at: "x", stories: [] }).join("\n")).toContain(
      "missing required field 'version'",
    );
  });

  it("nikos validate still rejects an unknown field in storymap.yaml", () => {
    const g = groupRepo("PAY");
    const storymap = join(g, "maps/chk/storymap.yaml");
    writeFileSync(storymap, readFileSync(storymap, "utf8") + "forecast: soon\n");
    const messages = validate(g, "chk").errors.map((e) => e.message);
    expect(messages.join("\n")).toContain("unknown field 'forecast'");
  });
});
