// Settings reach a team through the plans it joins: the group's and company's locks, and only those.
// The team keeps its own values wherever nothing above locked them. Each plan is a copy in
// .nikos/upstream, as planning sync leaves it; the copies are made here by hand.
import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSettings, resolveSettingsDetailed, setSetting } from "../src/lib/settings";
import { groupRepo, teamRepo, write, commitAll } from "./team-fixture";

/** A company plan repo: it locks approval.policy. */
function company(): string {
  const dir = groupRepo("CO", mkdtempSync(join(tmpdir(), "nikos-company-")));
  // Replace the group plan with a company plan: the level is what a company's repo says.
  write(join(dir, "planning/plan.yaml"), "name: Acme\nperiod: Q1 2027\nlevel: company\npillars: []\n");
  write(join(dir, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked:\n  - approval.policy\n");
  commitAll(dir, "company settings");
  return dir;
}

/** Copy a plan's files into the team's cache, as planning sync does. */
function cache(t: string, repo: string, dir: string): void {
  rmSync(join(t, ".nikos/upstream", ...repo.split("/")), { recursive: true, force: true });
  cpSync(dir, join(t, ".nikos/upstream", ...repo.split("/")), { recursive: true, filter: (p) => !p.includes("/.git") });
}

/** A team homed in a group, which locks tracker.system and sits under a company that locks approval.policy. */
function setup(groupSettings = "format_version: 1\ntracker:\n  system: github\n  site: https://group.example\nlocked:\n  - tracker.system\n") {
  const co = company();
  const g = groupRepo("PAY");
  write(join(g, "planning/upstream.yaml"), `- repo: acme/company-plan\n  url: ${co}\n`);
  write(join(g, "nikos.settings.yaml"), groupSettings);
  commitAll(g, "group settings");
  const t = teamRepo();
  write(join(t, "nikos.team.yaml"), "format_version: 2\nname: Checkout web\nrepo: acme/checkout-web\nkey: WEB\nhome: acme/pay/checkout-group\ngroups: []\nmembers: []\n");
  cache(t, "acme/pay/checkout-group", g);
  cache(t, "acme/company-plan", co);
  commitAll(t, "join");
  return { co, g, t };
}

describe("settings in a team repo", () => {
  it("a group lock reaches the team, with the group named as the locking level", () => {
    const { t } = setup();
    expect(resolveSettings(t)["tracker.system"]).toEqual({ value: "github", from: "acme/pay/checkout-group", lockedBy: "acme/pay/checkout-group" });
  });

  it("a team can't change a locked setting, with the same message as anywhere else", () => {
    const { t } = setup();
    expect(() => setSetting(t, "tracker.system", "jira")).toThrow("tracker.system is locked by acme/pay/checkout-group, so it can't be changed here");
  });

  it("a group's unlocked value does not apply, and the team keeps its own", () => {
    const { t } = setup();
    expect(resolveSettings(t)["tracker.site"]).toEqual({ value: "", from: "default" });
    setSetting(t, "tracker.site", "https://team.example");
    expect(resolveSettings(t)["tracker.site"]).toEqual({ value: "https://team.example", from: "this repo" });
  });

  it("a company lock reaches the team through its group's copy", () => {
    const { t } = setup();
    expect(resolveSettings(t)["approval.policy"]).toMatchObject({ value: "required-for-release", lockedBy: "acme/company-plan" });
    expect(() => setSetting(t, "approval.policy", "off")).toThrow("approval.policy is locked by acme/company-plan");
  });

  it("a plan copy that doesn't read is named as a problem, and nothing throws", () => {
    const { t } = setup();
    write(join(t, ".nikos/upstream/acme/pay/checkout-group/nikos.settings.yaml"), "format_version: 1\nlocked: [nope]\n");
    expect(() => resolveSettings(t)).not.toThrow();
    const r = resolveSettingsDetailed(t);
    expect(r.problems.some((p) => p.startsWith("acme/pay/checkout-group is skipped, so its locks don't apply here: "))).toBe(true);
  });
});
