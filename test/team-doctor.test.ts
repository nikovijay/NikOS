import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { doctor, type Check } from "../src/commands/doctor";
import { memberAdd, teamJoin } from "../src/commands/team";
import { setupVerify } from "../src/commands/verify";
import { groupRepo, teamRepo, write, commitAll } from "./team-fixture";
import { assign } from "../src/commands/assign";

const find = (checks: Check[], name: string) => checks.find((c) => c.name === name);

describe("nikos doctor in a team repo", () => {
  it("says what the team is, and which groups are synced", () => {
    const g = groupRepo("PAY");
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    commitAll(g, "assign");
    const t = teamRepo();
    teamJoin(t, "acme/payments/checkout-group", { url: g });
    memberAdd(t, "Priya Shah", { role: "Lead", handle: "priya-s" });
    const checks = doctor(t, { offline: true });
    expect(find(checks, "team")).toMatchObject({ status: "ok", found: '"Checkout web", 1 member, 1 group' });
    expect(find(checks, "group acme/payments/checkout-group")).toMatchObject({ status: "ok" });
    expect(find(checks, "group acme/payments/checkout-group")!.found).toMatch(/^synced [0-9a-f]{7} /);
  });

  it("warns about a group that isn't synced yet", () => {
    const t = teamRepo();
    write(join(t, "nikos.team.yaml"), `format_version: 1\nname: Checkout web\nrepo: acme/checkout-web\ngroups:\n  - repo: acme/payments/checkout-group\n    url: /nowhere/checkout-group\nmembers: []\n`);
    commitAll(t, "team");
    const notSynced = find(doctor(t, { offline: true }), "group acme/payments/checkout-group");
    expect(notSynced).toMatchObject({ status: "warn", found: "not synced yet", next: "Run nikos sync" });
  });

  it("warns about a group that has moved on since the last sync", () => {
    const g = groupRepo("PAY");
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    commitAll(g, "assign");
    const t = teamRepo();
    teamJoin(t, "acme/payments/checkout-group", { url: g });
    expect(find(doctor(t), "group acme/payments/checkout-group")!.status).toBe("ok");
    write(join(g, "maps/chk/features/pay/extra.feature"), "@PAY-CHK-9 @release-1\nFeature: Extra\n");
    commitAll(g, "move on");
    const moved = find(doctor(t), "group acme/payments/checkout-group");
    expect(moved).toMatchObject({ status: "warn", next: "Run nikos sync" });
    expect(moved!.found).toMatch(/^moved on since [0-9a-f]{7} /);
  });

  it("suggests a CODEOWNERS rule for the lead when there's none", () => {
    const t = teamRepo();
    memberAdd(t, "Priya Shah", { role: "Lead", handle: "priya-s" });
    expect(find(doctor(t, { offline: true }), "approvals")!.next).toBe('Suggest: add "/approvals/ @priya-s" to CODEOWNERS, so a delivery approval needs the lead\'s review');
  });

  it("warns when the copies aren't gitignored, and when the runner doesn't read them", () => {
    const t = teamRepo();
    expect(find(doctor(t, { offline: true }), "copies")).toMatchObject({ status: "warn", found: ".nikos/ isn't gitignored" });
    setupVerify(t);
    write(join(t, "cucumber.mjs"), 'export default { paths: ["intent/features/**/*.feature"] };\n');
    expect(find(doctor(t, { offline: true }), "scenario runner")).toMatchObject({ status: "warn", found: "cucumber.mjs doesn't run the assigned stories" });
  });

  it("says once that a repo with its own story map isn't a team, with no ok team line", () => {
    const t = teamRepo();
    write(join(t, "intent/storymap.yaml"), "key: HT\n");
    const team = doctor(t, { offline: true }).filter((c) => c.name === "team");
    expect(team.map((c) => c.status)).toEqual(["fail"]);
    expect(team[0].found).toBe("this repo has intent/ or maps/ and nikos.team.yaml: keep one");
  });
});
