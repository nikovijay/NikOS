import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { assign } from "../src/commands/assign";
import { teamJoin } from "../src/commands/team";
import { mapStatus, writeSummaries } from "../src/commands/map-status";
import { readDeliverySummary, summaryAge } from "../src/lib/delivery-summary";
import { setState } from "../src/commands/state";
import { groupRepo, git, teamRepo, commitAll } from "./team-fixture";
import { teamSync } from "../src/team/sync";

/** A group with its map assigned to one team, given an origin so its repo path is known, and the team joined and synced. */
function setup() {
  const g = groupRepo("PAY");
  git(g, "remote", "add", "origin", "https://github.com/acme/payments-group.git");
  assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
  commitAll(g, "assign");
  const t = teamRepo();
  teamJoin(t, "acme/pay/checkout-group", { url: g });
  commitAll(t, "join");
  return { g, t };
}

const NOW = new Date("2026-11-08T09:12:00Z");

describe("the delivery summary a group's owner commits", () => {
  it("nikos map status writes maps/<key>/delivery.yaml in the group's repo, one story per line", () => {
    const { g } = setup();
    const written = writeSummaries(g, mapStatus(g), NOW);
    expect(written.skipped).toBeUndefined();
    expect(written.written).toEqual([join(g, "maps/chk/delivery.yaml")]);
    const text = readFileSync(join(g, "maps/chk/delivery.yaml"), "utf8");
    expect(text).toContain("Commit it");
    const data = parse(text);
    expect(data).toMatchObject({ format_version: 1, map: "chk", owner: "acme/payments-group", read_at: "2026-11-08T09:12:00Z" });
    expect(data.stories.map((s: { id: string }) => s.id)).toEqual(["PAY-CHK-1", "PAY-CHK-2", "PAY-CHK-3"]);
    expect(data.stories[0]).toMatchObject({ id: "PAY-CHK-1", team: "acme/checkout-web", status: "todo", approval: "none", read_at: "2026-11-08T09:12:00Z" });
    // Story 3 is in release 2, which this team wasn't assigned: nobody holds it.
    expect(data.stories[2]).toMatchObject({ id: "PAY-CHK-3", team: "none" });
  });

  it("the reader reads what the writer wrote, and says how old it is", () => {
    const { g } = setup();
    writeSummaries(g, mapStatus(g), NOW);
    const summary = readDeliverySummary(join(g, "maps/chk"));
    expect(summary?.stories.length).toBe(3);
    expect(summaryAge(summary!, new Date("2026-11-11T09:12:00Z"))).toBe("read 3 days ago (2026-11-08)");
    expect(summaryAge(summary!, new Date("2026-11-09T09:12:00Z"))).toBe("read 1 day ago (2026-11-08)");
    expect(summaryAge(summary!, new Date("2026-11-08T18:00:00Z"))).toBe("read today (2026-11-08)");
  });

  it("a summary that doesn't match its schema is read as none, so the rollout says no summary yet", () => {
    const { g } = setup();
    writeSummaries(g, mapStatus(g), NOW);
    const path = join(g, "maps/chk/delivery.yaml");
    writeFileSync(path, readFileSync(path, "utf8").replace("format_version: 1", "format_version: 2"));
    expect(readDeliverySummary(join(g, "maps/chk"))).toBeUndefined();
  });

  it("an offline read writes nothing, since its copies are old", () => {
    const { g } = setup();
    expect(writeSummaries(g, mapStatus(g, { offline: true }), NOW).written).toEqual([]);
    expect(existsSync(join(g, "maps/chk/delivery.yaml"))).toBe(false);
  });

  it("a group with no origin says why the summary isn't written, and writes nothing", () => {
    const g = groupRepo("PAY");
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    commitAll(g, "assign");
    const res = writeSummaries(g, mapStatus(g), NOW);
    expect(res.written).toEqual([]);
    expect(res.skipped).toMatch(/no origin remote/);
  });

  it("assigned copies are never written: the team's tree has no delivery.yaml", () => {
    const { g, t } = setup();
    // The group's owner has a summary on disk, so a copy that picked it up would show here.
    writeSummaries(g, mapStatus(g), NOW);
    expect(allFiles(g).filter((p) => p.endsWith("delivery.yaml"))).toHaveLength(1);
    setState("PAY-CHK-1", "in_progress", { dir: t, by: "Priya" });
    commitAll(t, "start");
    teamSync(t);
    expect(allFiles(t).filter((p) => p.endsWith("delivery.yaml"))).toEqual([]);
    // A writer run against the copy the team holds writes nothing: the copy has no origin, so there is nothing to name.
    const copy = join(t, ".nikos", "assigned", "acme", "payments-group");
    expect(writeSummaries(copy, [{ ...mapStatus(g)[0], assigned: true, offline: false }]).written).toEqual([]);
    expect(allFiles(t).filter((p) => p.endsWith("delivery.yaml"))).toEqual([]);
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
