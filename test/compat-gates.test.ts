// The opt-in gates keep a 0.3.0 team repo working as it did: its settings come from the plans it
// joined (a team with a planning/ folder and no key or home), doctor doesn't warn about a home it was
// never asked to have, and a keyless team can still be made in a group repo. A key can be added later.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teamInit } from "../src/commands/team";
import { doctor } from "../src/commands/doctor";
import { resolveSettings } from "../src/lib/settings";
import { openTeam, teamOptedIn } from "../src/lib/team";
import { groupRepo, teamRepo, write } from "./team-fixture";

/** A 0.3.0-shaped team repo that also keeps a planning/ folder and a synced copy of a company plan that locks a setting. */
function legacyTeamWithPlanning(): string {
  const t = teamRepo();
  write(join(t, "planning/notes.md"), "Team notes, not a plan.\n");
  write(join(t, "planning/upstream.yaml"), "- repo: acme/company-plan\n");
  write(join(t, ".nikos/upstream/acme/company-plan/nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked:\n  - approval.policy\n");
  return t;
}

describe("a 0.3.0 team with a planning/ folder and no key or home keeps its joined plan's locks", () => {
  it("is not opted in, and its settings come from the joined copy as in 0.3.0", () => {
    const t = legacyTeamWithPlanning();
    expect(teamOptedIn(t)).toBe(false);
    const policy = resolveSettings(t)["approval.policy"];
    expect(policy.value).toBe("required-for-release");
    expect(policy.lockedBy).toBe("acme/company-plan");
  });

  it("with no planning/ folder, settings still come from the team's groups as before", () => {
    const t = teamRepo();
    expect(resolveSettings(t)["approval.policy"].lockedBy).toBeUndefined();
  });
});

describe("doctor does not add a home warning to a 0.3.0 team that joined a plan", () => {
  it("prints no home or key check for a team that has not opted in", () => {
    const t = legacyTeamWithPlanning();
    const names = doctor(t, { offline: true }).map((c) => c.name);
    expect(names).not.toContain("home");
    expect(names).not.toContain("key");
  });

  it("still warns about a home for a team that has opted in with a key", () => {
    const t = teamRepo();
    teamInit(t, { repo: "acme/checkout-web", name: "Checkout web", key: "WEB" });
    write(join(t, "planning/upstream.yaml"), "- repo: acme/company-plan\n");
    const home = doctor(t, { offline: true }).filter((c) => c.name === "home");
    expect(home.map((c) => c.found)).toContain("joins a plan but has no home");
  });
});

describe("team init keeps the 0.3.0 shape of a keyless team in a group repo", () => {
  it("writes a format 1 file in a group repo with no maps when no key is given", () => {
    const g = mkdtempSync(join(tmpdir(), "nikos-team-group-"));
    write(join(g, "planning/plan.yaml"), "name: Checkout PAY\nkey: PAY\nperiod: Q1 2027\nlevel: group\npillars: []\n");
    teamInit(g, { repo: "acme/payments-group" });
    const team = openTeam(g);
    expect(team.format_version).toBe(1);
    expect(team.key).toBeUndefined();
    expect(teamOptedIn(g)).toBe(false);
  });

  it("refuses a keyed team in a group repo, since its key would be a second plan's", () => {
    const g = groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-team-group-")));
    expect(() => teamInit(g, { repo: "acme/payments-group", key: "WEB" })).toThrow("a plan repo can't also be a team repo");
  });
});

describe("team init can give a keyless team its key", () => {
  it("adds the key and moves the file to format 2, keeping the rest of the team", () => {
    const t = teamRepo();
    teamInit(t, { repo: "acme/checkout-web", name: "Checkout web", key: "WEB" });
    const team = openTeam(t);
    expect(team).toMatchObject({ key: "WEB", format_version: 2, name: "Checkout web", repo: "acme/checkout-web" });
    expect(teamOptedIn(t)).toBe(true);
  });

  it("is refused when the team already has a key, and says where to change it", () => {
    const t = teamRepo();
    teamInit(t, { repo: "acme/checkout-web", name: "Checkout web", key: "WEB" });
    expect(() => teamInit(t, { key: "INB" })).toThrow("this team's key is already WEB");
  });

  it("is refused with a bad key before the file changes", () => {
    const t = teamRepo();
    expect(() => teamInit(t, { key: "web" })).toThrow("is not a team key");
    expect(openTeam(t).format_version).toBe(1);
  });
});

describe("the CLI refuses a 0.3.0 team with a joined plan as before", () => {
  it("planning validate and planning status name the team repo, and exit 1", () => {
    const t = legacyTeamWithPlanning();
    for (const cmd of ["validate", "status"]) {
      const r = spawnSync(process.execPath, ["--import", "tsx", join(__dirname, "../src/cli.ts"), "planning", cmd, "--dir", t], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("this is a team repo: nikos planning runs in a group or plan repo");
    }
  });
});
