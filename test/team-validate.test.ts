import { describe, it, expect, vi } from "vitest";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assign } from "../src/commands/assign";
import { memberAdd, teamJoin } from "../src/commands/team";
import { validate } from "../src/commands/validate";
import { runTeamSync } from "../src/team/sync";
import { groupRepo, teamRepo, write, commitAll } from "./team-fixture";
import { teamSync } from "../src/team/sync";

/** A team with the group's release 1 synced. */
function synced() {
  const g = groupRepo("PAY");
  assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
  commitAll(g, "assign");
  const t = teamRepo();
  teamJoin(t, "acme/payments/checkout-group", { url: g });
  commitAll(t, "join");
  return { g, t };
}

describe("validate on a team repo", () => {
  it("is clean once synced", () => {
    const { t } = synced();
    const v = validate(t, undefined, { remote: false });
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.stories).toBe(2);
  });

  it("warns about a group that isn't synced yet", () => {
    const t = teamRepo();
    write(join(t, "nikos.team.yaml"), "format_version: 1\nname: Checkout web\nrepo: acme/checkout-web\ngroups:\n  - repo: acme/payments/checkout-group\n    url: /nowhere/checkout-group\nmembers: []\n");
    expect(validate(t, undefined, { remote: false }).warnings.map((w) => w.message)).toEqual(["group acme/payments/checkout-group: not synced yet"]);
  });

  it("reports a story that two synced copies both hold, when the team file lists both groups", () => {
    const { t } = synced();
    cpSync(join(t, ".nikos/assigned/acme/payments/checkout-group"), join(t, ".nikos/assigned/acme/payments-copy"), { recursive: true });
    // teamJoin refuses a second group with the same key, so only a hand-edited team file gets here.
    const team = readFileSync(join(t, "nikos.team.yaml"), "utf8");
    write(join(t, "nikos.team.yaml"), team.replace("members: []", "  - repo: acme/payments-copy\n    url: /nowhere/copy\nmembers: []"));
    const v = validate(t, undefined, { remote: false });
    expect(v.errors.map((e) => e.message)).toContain("PAY-CHK-1 is in two synced copies");
  });

  it("ignores a copy of a group the team no longer takes work from", () => {
    const { t } = synced();
    cpSync(join(t, ".nikos/assigned/acme/payments/checkout-group"), join(t, ".nikos/assigned/acme/payments-copy"), { recursive: true });
    const v = validate(t, undefined, { remote: false });
    expect(v.errors).toEqual([]);
    expect(v.stories).toBe(2);
  });

  it("warns about a status for a story no synced copy has, and about an approver who isn't a member", () => {
    const { t } = synced();
    write(join(t, "status/PAY-CHK-9.yaml"), "status: in_progress\n");
    write(join(t, "status/PAY-CHK-1.yaml"), "status: done\nspec_hash: 0123456789ab\nevidence:\n  run_at: '2027-01-05T10:00:00Z'\n  runner: cucumber\n  commit: abcdef1234567\n  ok: true\n");
    write(join(t, "approvals/PAY-CHK-1.yaml"), "by: Sam Lee\non: 2027-01-06\nspec_hash: 0123456789ab\ndone_at: '2027-01-05T10:00:00Z'\ntested_commit: abcdef1234567\n");
    const v = validate(t, undefined, { remote: false });
    expect(v.warnings.map((w) => w.message)).toContain("PAY-CHK-9 has status but isn't in any synced copy");
    expect(v.warnings.map((w) => w.message)).toContain("approved by Sam Lee, who isn't listed in nikos.team.yaml");
    expect(v.errors.map((e) => e.message).some((m) => m.startsWith("approval is for spec 0123456789ab, the story is now "))).toBe(true);
  });

  it("refuses a delivery approval for a commit other than the one the story was tested at", () => {
    const { t } = synced();
    write(join(t, "status/PAY-CHK-1.yaml"), "status: done\nevidence:\n  run_at: '2027-01-05T10:00:00Z'\n  runner: cucumber\n  commit: abcdef1234567\n  ok: true\n");
    write(join(t, "approvals/PAY-CHK-1.yaml"), "by: Priya Shah\non: 2027-01-06\nspec_hash: '000000000000'\ndone_at: '2027-01-05T10:00:00Z'\ntested_commit: 1111111aaaaaa\n");
    memberAdd(t, "Priya Shah");
    const messages = validate(t, undefined, { remote: false }).errors.map((e) => e.message);
    expect(messages).toContain("approval is for commit 1111111, but the story was tested at abcdef1");
  });

  it("is refused by sync in a repo that isn't a team's, and by sync when it also has intent/", () => {
    const g = groupRepo("PAY");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runTeamSync(["--dir", g])).toBe(1);
    expect(err).toHaveBeenCalledWith("✗ nikos sync is for a team repo that takes work from a group: nikos team init, then nikos team join <group repo>; planning repos use nikos planning sync");
    err.mockRestore();

    const { t } = synced();
    write(join(t, "intent/storymap.yaml"), "key: HT\n");
    expect(() => teamSync(t)).toThrow("this repo has intent/ or maps/ and nikos.team.yaml: keep one");
    rmSync(join(t, "intent"), { recursive: true, force: true });
  });
});
