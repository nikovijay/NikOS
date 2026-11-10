// A map of a repo gets a delivery summary, and its stories are read from the map's own
// state.yaml (rule 9). A map the summary doesn't cover counts as no summary yet, never todo
// from a folder that holds no state for it.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { mapStatus, writeSummaries } from "../src/commands/map-status";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { readDeliverySummary } from "../src/lib/delivery-summary";
import { git, write, commitAll } from "./repo-fixture";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

/** A group repo with one map of its own (INB) with one story (PAY-INB-1). */
function ownMapRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-own-delivery-"));
  write(join(dir, "package.json"), '{"name":"web","private":true}\n');
  git(dir, "init", "-q", "-b", "main");
  write(join(dir, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
  commitAll(dir, "group");
  newMap({ bet: "faster-checkout", key: "INB", owner: "PAY" }, dir);
  newStory({ title: "Pay by card", activity: "getting-started" }, dir);
  commitAll(dir, "map");
  return dir;
}

describe("a repo's own map", () => {
  it("is a map with stories of its own, and its summary says each one's status from the map's own state.yaml", () => {
    const t = ownMapRepo();
    write(join(t, "maps/inb/state.yaml"), "format_version: 1\nstories:\n  PAY-INB-1: { status: done }\n");
    const results = mapStatus(t);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ map: "inb" });
    expect(results[0].stories.map((s) => [s.id, s.status])).toEqual([["PAY-INB-1", "done"]]);
    expect(writeSummaries(t, results, new Date("2026-11-08T09:00:00Z"))).toEqual([join(t, "maps/inb/delivery.yaml")]);
    expect(existsSync(join(t, "maps/inb/delivery.yaml"))).toBe(true);
    expect(parse(readFileSync(join(t, "maps/inb/delivery.yaml"), "utf8")).stories[0]).toMatchObject({ id: "PAY-INB-1", status: "done" });
  });

  it("is read from its summary, not from the map folder, so a plan above shows it done", () => {
    const t = ownMapRepo();
    write(join(t, "maps/inb/state.yaml"), "format_version: 1\nstories:\n  PAY-INB-1: { status: done }\n");
    writeSummaries(t, mapStatus(t), new Date("2026-11-08T09:00:00Z"));
    // The state moves on after the summary was written: the rollout still reads the summary.
    write(join(t, "maps/inb/state.yaml"), "format_version: 1\nstories:\n  PAY-INB-1: { status: todo }\n");
    const summary = readDeliverySummary(join(t, "maps/inb"), "code");
    expect(summary?.stories).toEqual([expect.objectContaining({ id: "PAY-INB-1", status: "done" })]);
  });

  it("with no summary yet has nothing to read, so its stories aren't counted as todo", () => {
    const t = ownMapRepo();
    write(join(t, "maps/inb/state.yaml"), "format_version: 1\nstories:\n  PAY-INB-1: { status: done }\n");
    rmSync(join(t, "maps/inb/delivery.yaml")); // newMap writes one; this case has none
    expect(readDeliverySummary(join(t, "maps/inb"), "code")).toBeUndefined();
  });
});
