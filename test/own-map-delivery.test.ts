// A team's own map still gets a delivery summary, and its stories are read from the map's own
// state.yaml (rule 9). A map the summary doesn't cover counts as no summary yet, never todo
// from a folder that holds no state for it.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { mapStatus, writeSummaries } from "../src/commands/map-status";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { mapDeliveryIn } from "../src/planning/delivery";
import { git, write, commitAll } from "./team-fixture";
import { teamInit } from "../src/commands/team";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

/** A team repo with a key and a home, an origin, and one map of its own with one story (WEB-INB-1). */
function teamWithOwnMap(): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-own-delivery-"));
  write(join(dir, "package.json"), '{"name":"web","private":true}\n');
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", "https://github.com/acme/web-team.git");
  teamInit(dir, { repo: "acme/web-team", name: "Web team", key: "WEB" });
  write(join(dir, "nikos.team.yaml"), "format_version: 2\nname: Web team\nrepo: acme/web-team\nkey: WEB\nhome: acme/payments-group\ngroups: []\nmembers: []\n");
  write(join(dir, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
  commitAll(dir, "team");
  newMap({ bet: "faster-checkout", key: "INB" }, dir);
  newStory({ title: "Pay by card", activity: "getting-started" }, dir);
  commitAll(dir, "map");
  return dir;
}

describe("a team's own map with no assignments", () => {
  it("is a map with stories of its own, and its summary says each one's status from the map's own state.yaml", () => {
    const t = teamWithOwnMap();
    write(join(t, "maps/inb/state.yaml"), "format_version: 1\nstories:\n  WEB-INB-1: { status: done }\n");
    const results = mapStatus(t);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ map: "inb" });
    expect(results[0].stories.map((s) => [s.id, s.status])).toEqual([["WEB-INB-1", "done"]]);
    expect(writeSummaries(t, results, new Date("2026-11-08T09:00:00Z"))).toEqual([join(t, "maps/inb/delivery.yaml")]);
    expect(existsSync(join(t, "maps/inb/delivery.yaml"))).toBe(true);
    expect(parse(readFileSync(join(t, "maps/inb/delivery.yaml"), "utf8")).stories[0]).toMatchObject({ id: "WEB-INB-1", status: "done" });
  });

  it("is counted from its summary, not from the map folder, so the rollout shows it done", () => {
    const t = teamWithOwnMap();
    write(join(t, "maps/inb/state.yaml"), "format_version: 1\nstories:\n  WEB-INB-1: { status: done }\n");
    writeSummaries(t, mapStatus(t), new Date("2026-11-08T09:00:00Z"));
    // The state moves on after the summary was written: the rollout still reads the summary.
    write(join(t, "maps/inb/state.yaml"), "format_version: 1\nstories:\n  WEB-INB-1: { status: todo }\n");
    const d = mapDeliveryIn(t);
    expect(d.stories).toEqual([expect.objectContaining({ id: "WEB-INB-1", status: "done" })]);
    expect(d.noSummary).toEqual([]);
  });

  it("with no summary yet counts its stories as no summary yet, not as todo", () => {
    const t = teamWithOwnMap();
    write(join(t, "maps/inb/state.yaml"), "format_version: 1\nstories:\n  WEB-INB-1: { status: done }\n");
    rmSync(join(t, "maps/inb/delivery.yaml")); // newMap writes one; this case has none
    const d = mapDeliveryIn(t);
    expect(d.stories).toEqual([]);
    expect(d.noSummary).toEqual(["WEB-INB-1"]);
  });
});
