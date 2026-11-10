import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../src/commands/validate";
import { writeMapSummary } from "../src/lib/map-summary";
import { specHash } from "../src/lib/project";
import { commitAll, groupRepo, write } from "./repo-fixture";

/** A group repo with its one map (PAY-CHK, three stories), committed. */
function synced() {
  const t = groupRepo("PAY");
  return { t };
}

describe("validate on a repo's own map", () => {
  it("is clean with its own map", () => {
    const { t } = synced();
    const v = validate(t);
    expect(v.errors.map((e) => `${e.file}: ${e.message}`)).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.stories).toBe(3);
  });

  it("warns about an approval whose feature changed", () => {
    const { t } = synced();
    write(join(t, "maps/chk/state.yaml"), "format_version: 1\nstories:\n  PAY-CHK-1: { status: done, spec_hash: 0123456789ab, done_at: '2027-01-05T10:00:00Z' }\n  PAY-CHK-2: { status: todo }\n  PAY-CHK-3: { status: todo }\n  PAY-CHK-9: { status: in_progress }\n");
    write(join(t, "maps/chk/approvals/PAY-CHK-1.yaml"), "by: Sam Lee\non: 2027-01-06\nspec_hash: 0123456789ab\ndone_at: '2027-01-05T10:00:00Z'\ntested_commit: abcdef1234567\n");
    const v = validate(t);
    expect(v.warnings.map((w) => w.message)).toContain("PAY-CHK-1's approval no longer holds: its feature changed since");
  });

  it("warns about an approval for a commit other than the one the story was tested at", () => {
    const { t } = synced();
    const hash = specHash(readFileSync(join(t, "maps/chk/features/pay/pay-by-card.feature"), "utf8"));
    write(join(t, "maps/chk/state.yaml"), "format_version: 1\nstories:\n  PAY-CHK-1: { status: done, done_at: '2027-01-05T10:00:00Z', evidence: { run_at: '2027-01-05T10:00:00Z', runner: cucumber, commit: abcdef1234567, ok: true } }\n  PAY-CHK-2: { status: todo }\n  PAY-CHK-3: { status: todo }\n");
    writeMapSummary(t, join(t, "maps/chk")); // the summary says what the state says, as nikos map status writes it
    write(join(t, "maps/chk/approvals/PAY-CHK-1.yaml"), `by: Priya Shah\non: 2027-01-06\nspec_hash: ${hash}\ndone_at: '2027-01-05T10:00:00Z'\ntested_commit: 1111111aaaaaa\n`);
    const v = validate(t);
    expect(v.warnings.map((w) => w.message)).toContain("PAY-CHK-1's approval no longer holds: it was tested at another commit");
    expect(v.errors).toEqual([]);
  });

  it("refuses a delivery.yaml that no longer says what the map's files say", () => {
    const { t } = synced();
    const summary = readFileSync(join(t, "maps/chk/delivery.yaml"), "utf8");
    write(join(t, "maps/chk/delivery.yaml"), summary.replace("status: todo", "status: done"));
    expect(validate(t).errors.map((e) => e.message).join("\n")).toContain("delivery.yaml");
  });
});
