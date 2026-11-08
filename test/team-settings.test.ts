// Settings reach a team through its group: the group's and company's locks, and only those. The
// team keeps its own values wherever nothing above locked them.
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { assign } from "../src/commands/assign";
import { teamJoin } from "../src/commands/team";
import { resolveSettings, resolveSettingsDetailed, setSetting } from "../src/lib/settings";
import { store } from "../src/lib/store";
import { teamSync } from "../src/team/sync";
import { groupRepo, teamRepo, write, commitAll } from "./team-fixture";
import { mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";

/** A company plan repo: it locks approval.policy. */
function company(): string {
  const dir = groupRepo("CO", mkdtempSync(join(tmpdir(), "nikos-company-")));
  // Replace the group plan with a company plan: the level is what a company's repo says.
  write(join(dir, "planning/plan.yaml"), "name: Acme\nperiod: Q1 2027\nlevel: company\npillars: []\n");
  write(join(dir, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked:\n  - approval.policy\n");
  commitAll(dir, "company settings");
  return dir;
}

/** A team of a group whose settings lock tracker.system, set its site without locking it, and sit under the company. */
function setup(groupSettings = "format_version: 1\ntracker:\n  system: github\n  site: https://group.example\nlocked:\n  - tracker.system\n") {
  const co = company();
  const g = groupRepo("PAY");
  write(join(g, "planning/upstream.yaml"), `- repo: acme/company-plan\n  url: ${co}\n`);
  write(join(g, "nikos.settings.yaml"), groupSettings);
  assign(g, "web", { repo: "acme/checkout-web", releases: [1] });
  commitAll(g, "group settings");
  const t = teamRepo();
  teamJoin(t, "acme/pay/checkout-group", { url: g });
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

  it("a group copy that doesn't read is named as a problem, and nothing throws", () => {
    const { t } = setup();
    write(join(t, ".nikos/assigned/acme/pay/checkout-group/nikos.settings.yaml"), "format_version: 1\nlocked: [nope]\n");
    expect(() => resolveSettings(t)).not.toThrow();
    const r = resolveSettingsDetailed(t);
    expect(r.problems.some((p) => p.startsWith("acme/pay/checkout-group is skipped, so its locks don't apply here: "))).toBe(true);
    expect(store().exists(join(t, ".nikos/upstream/acme/company-plan/nikos.settings.yaml"))).toBe(true);
  });

  it("a company that can't be fetched this sync keeps its last good copy, so its lock still applies", () => {
    const { co, t } = setup();
    expect(resolveSettings(t)["approval.policy"]).toMatchObject({ value: "required-for-release", lockedBy: "acme/company-plan" });
    renameSync(co, `${co}-moved`);
    try {
      const r = teamSync(t);
      expect(r.upstream.some((u) => u.repo === "acme/company-plan")).toBe(true);
      expect(resolveSettings(t)["approval.policy"]).toMatchObject({ value: "required-for-release", lockedBy: "acme/company-plan" });
      expect(store().exists(join(t, ".nikos/upstream/acme/company-plan/nikos.settings.yaml"))).toBe(true);
    } finally {
      renameSync(`${co}-moved`, co);
    }
  });

  it("a group's settings file that doesn't read keeps the last good copy, with a warning from sync", () => {
    const { g, t } = setup();
    expect(resolveSettings(t)["tracker.system"]).toMatchObject({ value: "github", lockedBy: "acme/pay/checkout-group" });
    write(join(g, "nikos.settings.yaml"), "format_version: 1\nlocked: [nope]\n");
    commitAll(g, "broken settings");
    const r = teamSync(t);
    expect(r.warnings).toEqual([expect.stringContaining("acme/pay/checkout-group's nikos.settings.yaml: ")]);
    expect(r.warnings[0]).toContain("Kept the copy from the last sync");
    expect(resolveSettings(t)["tracker.system"]).toMatchObject({ value: "github", lockedBy: "acme/pay/checkout-group" });
  });
});
