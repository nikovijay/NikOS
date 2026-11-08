// The change file: the schema accepts what the editable export writes and nothing that carries
// credentials, urls or unknown operations.
import { describe, expect, it } from "vitest";
import { schemaProblems } from "../src/lib/schema";
import { OP_NAMES } from "../src/planning/ops";

const example = () => ({
  format: "nikos-planning-changes",
  format_version: 1,
  plan: { level: "department", name: "Payments" },
  source: { commit: "3f9c2a1b8d7e4c60a2f1d9e08b5c7a3e21f4d6b9", dirty: false, exported: "2026-11-08T09:14:00Z" },
  made_by: "Sam Example",
  with_linked: true,
  operations: [
    { op: "checkin", target: { kr: "checkout-conversion" }, args: { value: 41, date: "2026-11-07", note: "Week 45 readout" }, expect: "9d1e4f2a7c03b8e1" },
    { op: "checkin", target: { kr: "checkout-conversion" }, args: { value: 43, date: "2026-11-08" }, expect: "9d1e4f2a7c03b8e1" },
    { op: "bet.review", target: { bet: "faster-checkout" }, args: { decision: "continue", reason: "On track for the readout" }, expect: "0a7b3c9e21d4f508" },
  ],
});

const withOp = (op: Record<string, unknown>) => {
  const doc = example();
  doc.operations = [{ ...doc.operations[0], ...op }] as any;
  return doc;
};

describe("the change file schema", () => {
  it("accepts the example, with synthetic data", () => {
    expect(schemaProblems("planning/changes.schema.json", example())).toEqual([]);
  });

  it("rejects a token, a password or any other field the file must not carry", () => {
    const doc: any = { ...example(), token: "abc" };
    expect(schemaProblems("planning/changes.schema.json", doc).join("\n")).toContain("unknown field 'token'");
    expect(schemaProblems("planning/changes.schema.json", { ...example(), password: "x" }).length).toBeGreaterThan(0);
  });

  it("rejects a url field on an operation", () => {
    expect(schemaProblems("planning/changes.schema.json", withOp({ url: "https://example.test" })).join("\n")).toContain("unknown field 'url'");
  });

  it("rejects an operation name nikOS doesn't know", () => {
    expect(schemaProblems("planning/changes.schema.json", withOp({ op: "bet.delete" })).length).toBeGreaterThan(0);
  });

  it("rejects a file with no format_version", () => {
    const doc: any = example();
    delete doc.format_version;
    expect(schemaProblems("planning/changes.schema.json", doc).join("\n")).toContain("missing required field 'format_version'");
  });

  it("rejects an expect that isn't a 16-character hash", () => {
    expect(schemaProblems("planning/changes.schema.json", withOp({ expect: "not-a-hash" })).length).toBeGreaterThan(0);
  });

  it("names the same operations the op layer runs", () => {
    const doc = example();
    const names = (schemaProblems("planning/changes.schema.json", { ...doc, operations: OP_NAMES.map((op) => ({ op, args: {} })) }) as string[]);
    expect(names).toEqual([]);
  });
});
