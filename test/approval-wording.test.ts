import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Rule 11: an approval records who approved, and nothing presents that name as checked by the forge.
// No line of source that prints or stores approvals may put "verified" beside an approver, except to say it isn't.
const SRC = join(__dirname, "../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("approval wording", () => {
  it("no source line puts 'verified' beside an approval or an approver", () => {
    const offenders = sourceFiles(SRC).flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter((line) => /verified/i.test(line) && /approv/i.test(line) && !/not a verified/i.test(line))
        .map((line) => `${f}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the approval sites that print an approver say 'approved by', never a verified identity", () => {
    const status = readFileSync(join(SRC, "team/status.ts"), "utf8");
    expect(status).toContain("approved by ${f.approval.by}");
    expect(status).toContain("approved by ${v.approvedBy}");
    expect(readFileSync(join(SRC, "lib/delivery-summary.ts"), "utf8")).toContain("not a verified identity");
  });
});
