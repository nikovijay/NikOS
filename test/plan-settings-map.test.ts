// nikOS Plan, PR 4 of docs/rfcs/plan-and-spec.md, stage C: a code repo with nikos.plan.yaml resolves its
// settings per map: the company's levels, then the map owner's chain from the snapshot, then its own file.
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveSettings, resolveSettingsDetailed, setSetting } from "../src/lib/settings";
import { writeLink, type PlanLink } from "../src/plan/settings-link";
import { codeRepo, groupRepo, write } from "./repo-fixture";

/** A code repo whose map (maps/chk) is owned by WEB, and a second map (maps/pay) owned by the given owner, if any. */
function twoMaps(payOwner: string | null = "PAY"): string {
  const code = groupRepo("WEB", codeRepo());
  write(join(code, "maps/pay/storymap.yaml"), `format_version: 1\nproject: pay\nkey: PAY\n${payOwner ? `owner: ${payOwner}\n` : ""}activities: []\nreleases: []\n`);
  return code;
}

/** A snapshot of acme's plan: the company locks the approval policy; WEB's chain sets a project and tries to change the policy. */
const snapshot = (owners: PlanLink["owners"]): Omit<PlanLink, "sha256"> => ({
  format_version: 1,
  plan: { repo: "acme/company-plan" },
  read: { commit: "a".repeat(40), at: "2026-11-10T09:00:00.000Z" },
  company: [{ rel: "company", data: { format_version: 1, approval: { policy: "required-for-release" }, locked: ["approval.policy"] } }],
  owners,
});

const acmeOwners: PlanLink["owners"] = {
  WEB: {
    levels: [
      { rel: "departments/finance", data: { format_version: 1, tracker: { system: "jira" } } },
      { rel: "teams/WEB", data: { format_version: 1, approval: { policy: "off" }, tracker: { project: "PAY-TEAM" } } },
    ],
  },
  PAY: { levels: [{ rel: "teams/PAY", data: { format_version: 1, tracker: { project: "PAY-2" } } }] },
};

describe("a code repo's settings per map", () => {
  it("takes the company's levels then the map owner's chain, labelled with the plan and the area", () => {
    const code = twoMaps();
    writeLink(code, { ...snapshot(acmeOwners), sha256: "" });
    const r = resolveSettingsDetailed(code, { map: join(code, "maps/chk") });
    expect(r.resolved["tracker.system"]).toEqual({ value: "jira", from: "acme/company-plan departments/finance" });
    expect(r.resolved["tracker.project"]).toEqual({ value: "PAY-TEAM", from: "acme/company-plan teams/WEB" });
    expect(r.resolved["approval.policy"]).toEqual({ value: "required-for-release", from: "acme/company-plan company", lockedBy: "acme/company-plan company" });
    // The team's change to the locked key is ignored, and reported.
    expect(r.problems).toEqual(["approval.policy from acme/company-plan teams/WEB is ignored: acme/company-plan company locks it"]);
  });

  it("resolves each map by its own owner: two maps with two owners see two different teams", () => {
    const code = twoMaps();
    writeLink(code, { ...snapshot(acmeOwners), sha256: "" });
    expect(resolveSettings(code, { map: join(code, "maps/chk") })["tracker.project"].value).toBe("PAY-TEAM");
    expect(resolveSettings(code, { map: join(code, "maps/pay") })["tracker.project"]).toEqual({ value: "PAY-2", from: "acme/company-plan teams/PAY" });
  });

  it("the repo's own file can't change a key the company locked, and its value is reported", () => {
    const code = twoMaps();
    writeLink(code, { ...snapshot({}), sha256: "" });
    write(join(code, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: off\ntracker:\n  system: linear\n");
    const r = resolveSettingsDetailed(code, { map: join(code, "maps/chk") });
    expect(r.resolved["approval.policy"]).toEqual({ value: "required-for-release", from: "acme/company-plan company", lockedBy: "acme/company-plan company" });
    expect(r.resolved["tracker.system"]).toEqual({ value: "linear", from: "this repo" });
    expect(r.problems).toEqual(["approval.policy from this repo is ignored: acme/company-plan company locks it"]);
    expect(() => setSetting(code, "approval.policy", "optional")).toThrow("approval.policy is locked by acme/company-plan company, so it can't be changed here");
  });

  it("a map with no owner, or an owner with no team in the plan, takes the company's settings only", () => {
    const code = twoMaps(null);
    writeLink(code, { ...snapshot(acmeOwners), sha256: "" });
    const none = resolveSettingsDetailed(code, { map: join(code, "maps/pay") });
    expect(none.resolved["tracker.project"]).toEqual({ value: "", from: "default" });
    expect(none.resolved["approval.policy"].from).toBe("acme/company-plan company");
    expect(none.problems).toEqual([]);

    const unknown = twoMaps("NOPE");
    writeLink(unknown, { ...snapshot(acmeOwners), sha256: "" });
    expect(resolveSettings(unknown, { map: join(unknown, "maps/pay") })["tracker.project"].value).toBe("");
  });

  it("with no map, the repo's maps agree on one owner or the company's settings apply and the repo says why", () => {
    const code = twoMaps();
    writeLink(code, { ...snapshot(acmeOwners), sha256: "" });
    const split = resolveSettingsDetailed(code);
    expect(split.resolved["tracker.project"].value).toBe("");
    expect(split.problems).toContain("the maps have different owners (PAY, WEB), so this shows the company's settings only: pass --map");

    const agree = twoMaps("WEB");
    writeLink(agree, { ...snapshot(acmeOwners), sha256: "" });
    expect(resolveSettings(agree)["tracker.project"]).toEqual({ value: "PAY-TEAM", from: "acme/company-plan teams/WEB" });
  });
});
