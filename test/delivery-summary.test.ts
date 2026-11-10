// The delivery summary a map's owner commits: maps/<key>/delivery.yaml, written by nikos map status
// (and state set, approve and map new) from the map's own files. A summary that doesn't read is none.
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { mapStatus, writeSummaries } from "../src/commands/map-status";
import { readDeliverySummary, readDeliverySummaryResult, summaryAge, writeDeliverySummary } from "../src/lib/delivery-summary";
import { NewerContractError } from "../src/lib/schema";
import { setState } from "../src/commands/state";
import { groupRepo, commitAll } from "./repo-fixture";

const NOW = new Date("2026-11-08T09:12:00Z");

describe("the delivery summary a map's owner commits", () => {
  it("nikos map status writes maps/<key>/delivery.yaml in the group's repo, one story per line, with the owner from the storymap", () => {
    const g = groupRepo("PAY");
    const written = writeSummaries(g, mapStatus(g), NOW);
    expect(written).toEqual([join(g, "maps/chk/delivery.yaml")]);
    const text = readFileSync(join(g, "maps/chk/delivery.yaml"), "utf8");
    expect(text).toContain("Commit it");
    const data = parse(text);
    expect(data).toMatchObject({ version: 1, map: "chk", owner: "PAY", read_at: "2026-11-08T09:12:00Z" });
    expect(data.stories.map((s: { id: string }) => s.id)).toEqual(["PAY-CHK-1", "PAY-CHK-2", "PAY-CHK-3"]);
    expect(data.stories[0]).toMatchObject({ id: "PAY-CHK-1", status: "todo", approval: "none", read_at: "2026-11-08T09:12:00Z" });
    expect(data.stories[0]).not.toHaveProperty("team");
  });

  it("the reader reads what the writer wrote, and says how old it is", () => {
    const g = groupRepo("PAY");
    writeSummaries(g, mapStatus(g), NOW);
    const summary = readDeliverySummary(join(g, "maps/chk"), "planning");
    expect(summary?.stories.length).toBe(3);
    expect(summaryAge(summary!, new Date("2026-11-11T09:12:00Z"))).toBe("read 3 days ago (2026-11-08)");
    expect(summaryAge(summary!, new Date("2026-11-09T09:12:00Z"))).toBe("read 1 day ago (2026-11-08)");
    expect(summaryAge(summary!, new Date("2026-11-08T18:00:00Z"))).toBe("read today (2026-11-08)");
  });

  it("a summary that doesn't match its schema is read as none, with the reason kept for the result", () => {
    const g = groupRepo("PAY");
    writeSummaries(g, mapStatus(g), NOW);
    const path = join(g, "maps/chk/delivery.yaml");
    writeFileSync(path, readFileSync(path, "utf8").replace(/^read_at: .*\n/m, ""));
    expect(readDeliverySummary(join(g, "maps/chk"), "planning")).toBeUndefined();
    expect(readDeliverySummaryResult(join(g, "maps/chk"), "planning")).toMatchObject({ ok: false, reason: expect.stringMatching(/read_at/) });
  });

  it("a summary from a newer nikOS throws NewerContractError, so it is never mistaken for no summary", () => {
    const g = groupRepo("PAY");
    writeSummaries(g, mapStatus(g), NOW);
    const path = join(g, "maps/chk/delivery.yaml");
    writeFileSync(path, readFileSync(path, "utf8").replace("version: 1", "version: 2"));
    expect(() => readDeliverySummary(join(g, "maps/chk"), "planning")).toThrow(NewerContractError);
    expect(() => readDeliverySummary(join(g, "maps/chk"), "planning")).toThrow("this delivery.yaml was written by a newer nikOS: upgrade nikos in the planning repo");
    expect(readDeliverySummaryResult(join(g, "maps/chk"), "planning")).toEqual({
      ok: false,
      reason: "this delivery.yaml was written by a newer nikOS: upgrade nikos in the planning repo",
      newer: true,
    });
  });

  it("a summary written after a state change says the new status, and the owner is the group's key when the map names none", () => {
    const g = groupRepo("PAY");
    setState("PAY-CHK-2", "in_progress", { dir: g });
    writeSummaries(g, mapStatus(g), NOW);
    const data = readDeliverySummary(join(g, "maps/chk"), "planning")!;
    expect(data.owner).toBe("PAY");
    expect(data.stories.find((s) => s.id === "PAY-CHK-2")).toMatchObject({ status: "in_progress" });
  });

  it("a map's summary is written by the map's own folder only: no other folder gets a delivery.yaml", () => {
    const g = groupRepo("PAY");
    writeSummaries(g, mapStatus(g), NOW);
    commitAll(g, "summary");
    expect(allFiles(g).filter((p) => p.endsWith("delivery.yaml"))).toEqual([join(g, "maps/chk/delivery.yaml")]);
  });
});

/** Every file under a folder, skipping .git. */
function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === ".git") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? allFiles(p) : [p];
  });
}

describe("a delivery summary is rewritten on each run", () => {
  it("writes the same map's summary twice without an EEXIST, and the second read_at wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-sum-"));
    mkdirSync(join(dir, "maps/am"), { recursive: true });
    const base = { version: 1 as const, map: "am", owner: "PAY" };
    writeDeliverySummary(join(dir, "maps/am"), { ...base, read_at: "2027-01-01T00:00:00Z", stories: [] });
    expect(() => writeDeliverySummary(join(dir, "maps/am"), { ...base, read_at: "2027-01-02T00:00:00Z", stories: [] })).not.toThrow();
    expect(readDeliverySummary(join(dir, "maps/am"), "code")?.read_at).toBe("2027-01-02T00:00:00Z");
  });
});
