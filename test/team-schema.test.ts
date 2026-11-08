import { describe, it, expect } from "vitest";
import { parseTeam } from "../src/lib/team";
import { schemaProblems } from "../src/lib/schema";

describe("team file", () => {
  it("accepts a name, repo, groups and members with a role and a handle", () => {
    const t = parseTeam(
      "format_version: 1\nname: Checkout web\nrepo: acme/checkout-web\ngroups:\n  - repo: acme/payments/checkout-group\nmembers:\n  - name: Priya Shah\n    role: Lead\n    handle: priya-s\n",
    );
    expect(t.members).toEqual([{ name: "Priya Shah", role: "Lead", handle: "priya-s" }]);
    expect(t.groups).toEqual([{ repo: "acme/payments/checkout-group" }]);
  });

  it("refuses personal fields, a name with @, a handle with spaces, and unknown top-level keys", () => {
    expect(() => parseTeam("format_version: 1\nname: A\nrepo: acme/a\nmembers:\n  - name: P\n    email: p@example.test\n")).toThrow("unknown field 'email'");
    expect(() => parseTeam("format_version: 1\nname: A\nrepo: acme/a\nmembers:\n  - name: p@example.test\n")).toThrow();
    expect(() => parseTeam("format_version: 1\nname: A\nrepo: acme/a\nmembers:\n  - name: P\n    handle: priya s\n")).toThrow();
    expect(() => parseTeam("format_version: 1\nname: A\nrepo: acme/a\nowner: someone\n")).toThrow("unknown field 'owner'");
  });
});

describe("assignments", () => {
  it("accepts stories alone, or the whole map", () => {
    expect(schemaProblems("assignments.schema.json", [{ team: "A", repo: "acme/a", stories: ["PAY-CHK-1"] }, { team: "B", repo: "." }])).toEqual([]);
  });

  it("refuses two selectors together", () => {
    expect(schemaProblems("assignments.schema.json", [{ team: "A", repo: "acme/a", releases: [1], activities: ["pay"] }]).length).toBeGreaterThan(0);
    expect(schemaProblems("assignments.schema.json", [{ team: "A", repo: "acme/a", releases: [1], stories: ["PAY-CHK-1"] }]).length).toBeGreaterThan(0);
  });
});

describe("team status and delivery approval files", () => {
  it("status refuses unknown fields and accepts the evidence shape", () => {
    expect(schemaProblems("status.schema.json", { status: "done", evidence: { run_at: "2027-01-05", runner: "cucumber", commit: "abc1234", ok: true } })).toEqual([]);
    expect(schemaProblems("status.schema.json", { status: "todo", approved: true }).length).toBeGreaterThan(0);
  });

  it("delivery approval requires the tested commit", () => {
    const base = { by: "Priya Shah", on: "2027-01-05", spec_hash: "0123456789ab", done_at: "2027-01-04T10:00:00Z" };
    expect(schemaProblems("delivery-approval.schema.json", base).length).toBeGreaterThan(0);
    expect(schemaProblems("delivery-approval.schema.json", { ...base, tested_commit: "abc1234" })).toEqual([]);
  });
});
