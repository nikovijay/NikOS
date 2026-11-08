import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTeam, isTeamRepo, storyMapClash } from "../src/lib/team";
import { teamRepo } from "./team-fixture";
import { teamShow } from "../src/commands/team";
import { joinPlan } from "../src/commands/join";
import { rollout } from "../src/planning/rollout";
import { companyRepo, departmentRepo } from "./planning-fixture";
import { readFileSync } from "node:fs";

describe("a 0.3.0 repo keeps working", () => {
  it("a 0.3.0 team file (format 1, no key, no home) parses as it did", () => {
    const team = parseTeam("format_version: 1\nname: Checkout web\nrepo: acme/checkout-web\ngroups: []\nmembers: []\n");
    expect(team).toMatchObject({ format_version: 1, name: "Checkout web", repo: "acme/checkout-web", groups: [], members: [] });
    expect(team.key).toBeUndefined();
    expect(team.home).toBeUndefined();
  });

  it("a team with no key, no home and no maps shows as it did", () => {
    const t = teamRepo();
    expect(teamShow(t, { offline: true })[0]).toBe("Checkout web (acme/checkout-web)");
  });

  it("a team repo that still holds intent/ is refused with the 0.3.0 wording", () => {
    const t = teamRepo();
    mkdirSync(join(t, "intent"));
    expect(storyMapClash(t)).toBe("this repo has intent/ or maps/ and nikos.team.yaml: keep one");
  });

  it("a 0.2.x repo with intent/ and no team file is not a team repo, so it is untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-021-"));
    mkdirSync(join(dir, "intent"));
    writeFileSync(join(dir, "intent/story.feature"), "Feature: x\n");
    expect(isTeamRepo(dir)).toBe(false);
  });

  it("a group with one upstream is unchanged: its join writes no home, and the company rollout lists nothing below", () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    // A plan joins one plan above it and names no home: the 0.3.0 entry, with no home key added.
    joinPlan(dept, { repo: "acme/company-plan", url: co });
    expect(readFileSync(join(dept, "planning/upstream.yaml"), "utf8")).not.toContain("home");
    expect(rollout(co, { offline: true }).plans).toEqual([]);
  });
});
