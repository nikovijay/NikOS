import { describe, it, expect } from "vitest";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { memberAdd } from "../src/commands/team";
import { validate } from "../src/commands/validate";
import { writeMapSummary } from "../src/lib/map-summary";
import { groupRepo, teamRepo, write, commitAll } from "./team-fixture";

/** A team that owns the group's map (PAY-CHK, three stories), with its bet, key and home, committed. */
function synced() {
  const g = groupRepo("PAY");
  const t = teamRepo();
  write(join(t, "nikos.team.yaml"), "format_version: 2\nname: Checkout web\nrepo: acme/checkout-web\nkey: WEB\nhome: acme/payments/checkout-group\ngroups: []\nmembers: []\n");
  write(join(t, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
  cpSync(join(g, "maps"), join(t, "maps"), { recursive: true });
  // The map keeps the group's ids (PAY-CHK-n) by naming PAY as its owner, and its summary says so.
  const storymap = join(t, "maps/chk/storymap.yaml");
  write(storymap, readFileSync(storymap, "utf8").replace("key: CHK\n", "key: CHK\nowner: PAY\n"));
  writeMapSummary(t, join(t, "maps/chk"));
  commitAll(t, "maps");
  return { g, t };
}

describe("validate on a team repo", () => {
  it("is clean with its own map", () => {
    const { t } = synced();
    const v = validate(t);
    expect(v.errors.map((e) => `${e.file}: ${e.message}`)).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.stories).toBe(3);
  });

  it("warns about a status for a story the team's maps don't have, and about an approver who isn't a member", () => {
    const { t } = synced();
    write(join(t, "status/PAY-CHK-9.yaml"), "status: in_progress\n");
    write(join(t, "status/PAY-CHK-1.yaml"), "status: done\nspec_hash: 0123456789ab\nevidence:\n  run_at: '2027-01-05T10:00:00Z'\n  runner: cucumber\n  commit: abcdef1234567\n  ok: true\n");
    write(join(t, "approvals/PAY-CHK-1.yaml"), "by: Sam Lee\non: 2027-01-06\nspec_hash: 0123456789ab\ndone_at: '2027-01-05T10:00:00Z'\ntested_commit: abcdef1234567\n");
    const v = validate(t);
    expect(v.warnings.map((w) => w.message)).toContain("PAY-CHK-9 has status but isn't in any of this team's maps");
    expect(v.warnings.map((w) => w.message)).toContain("approved by Sam Lee, who isn't listed in nikos.team.yaml");
    expect(v.errors.map((e) => e.message).some((m) => m.startsWith("approval is for spec 0123456789ab, the story is now "))).toBe(true);
  });

  it("refuses a delivery approval for a commit other than the one the story was tested at", () => {
    const { t } = synced();
    write(join(t, "status/PAY-CHK-1.yaml"), "status: done\nevidence:\n  run_at: '2027-01-05T10:00:00Z'\n  runner: cucumber\n  commit: abcdef1234567\n  ok: true\n");
    write(join(t, "approvals/PAY-CHK-1.yaml"), "by: Priya Shah\non: 2027-01-06\nspec_hash: '000000000000'\ndone_at: '2027-01-05T10:00:00Z'\ntested_commit: 1111111aaaaaa\n");
    memberAdd(t, "Priya Shah");
    const messages = validate(t).errors.map((e) => e.message);
    expect(messages).toContain("approval is for commit 1111111, but the story was tested at abcdef1");
  });

  it("refuses a delivery.yaml that no longer says what the map's files say", () => {
    const { t } = synced();
    const summary = readFileSync(join(t, "maps/chk/delivery.yaml"), "utf8");
    write(join(t, "maps/chk/delivery.yaml"), summary.replace("status: todo", "status: done"));
    expect(validate(t).errors.map((e) => e.message).join("\n")).toContain("delivery.yaml");
  });
});
