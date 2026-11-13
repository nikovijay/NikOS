// The rules the dashboard page embeds must give the same answers as the commands, row for row.
import { describe, expect, it } from "vitest";
import * as rules from "../src/planning/rules";

const fns = Object.entries(rules).filter(([, f]) => typeof f === "function") as [string, (...a: any[]) => any][];
// What the page does: each rule's source, joined into one script, run with new Function.
const embedded = new Function(`${fns.map(([, f]) => f.toString()).join("\n")}\nreturn { ${fns.map(([n]) => n).join(", ")} };`)() as Record<string, (...a: any[]) => any>;

const table: [string, unknown[]][] = [
  ["idProblem", ["kr", "Bad Id"]],
  ["idProblem", ["kr", "checkout-conversion"]],
  ["idProblem", ["bet", "../../etc"]],
  ["idProblem", ["story", "PAY-CHK-12"]],
  ["idProblem", ["story", "pay-chk-12"]],
  ["idProblem", ["activity", "Pay"]],
  ["idProblem", ["release", "one"]],
  ["titleProblem", ["kr", "   "]],
  ["titleProblem", ["story", ""]],
  ["numberProblem", ["checkin", "41"]],
  ["numberProblem", ["checkin", NaN]],
  ["numberProblem", ["checkin", 41]],
  ["decisionProblem", ["maybe"]],
  ["decisionProblem", ["complete"]],
  ["reasonProblem", ["  "]],
  ["reasonProblem", ["Still on track"]],
  ["dateProblem", ["2026-13"]],
  ["dateProblem", ["2027-03-31"]],
  ["krFieldProblems", [{ baseline: 1 }, "edit"]],
  ["krFieldProblems", [{ title: "", by: "soon" }, "edit"]],
  ["krFieldProblems", [{ title: "A", owner: "Ana", baseline: 1, target: 2, by: "2027-01-01" }, "new"]],
  ["krFieldProblems", [{ title: "A", owner: "Ana", baseline: 1, target: 2, by: "2027-01-01", direction: "sideways" }, "new"]],
  ["krFieldProblems", [{ direction: "down" }, "edit"]],
  ["krFieldProblems", [{ direction: "" }, "edit"]],
  ["krFieldProblems", [{ title: "A", owner: "Ana", by: "2027-01-01", kind: "milestone" }, "new"]],
  ["krFieldProblems", [{ title: "A", owner: "Ana", baseline: 1, target: 2, by: "2027-01-01", kind: "sideways" }, "new"]],
  ["krFieldProblems", [{ kind: "milestone" }, "edit"]],
  ["betFieldProblems", [{ outcome: "won" }]],
  ["laddersProblem", ["reconciliation revenue faster"]],
  ["laddersProblem", ["   "]],
  ["laddersProblem", ["two\nlines"]],
  ["krFieldProblems", [{ ladders_up: "sales faster" }, "edit"]],
  ["krFieldProblems", [{ ladders_up: 5 }, "edit"]],
  ["betFieldProblems", [{ ladders_up: "a\nb" }]],
  ["betFieldProblems", [{ owner: "", review_on: "2026-01-02", confidence: "huge" }]],
  ["betFieldProblems", [{ title: "   " }]],
  ["betFieldProblems", [{ title: "Two\nlines" }]],
  ["idFromTitle", ["Faster checkout!"]],
  ["idFromTitle", ["  --  "]],
  ["idFromTitle", ["Reduce the median number of days it takes the finance team to close each month"]],
];

describe("shared rules", () => {
  it("has the fixture table the drift check runs on", () => {
    expect(table.length).toBeGreaterThanOrEqual(12);
    expect(fns.map(([n]) => n).sort()).toEqual(["betFieldProblems", "dateProblem", "decisionProblem", "idFromTitle", "idProblem", "krFieldProblems", "laddersProblem", "numberProblem", "reasonProblem", "titleProblem"]);
  });

  it("the embedded copy gives the same answer as the command-line module, for every row", () => {
    for (const [name, args] of table) {
      expect(embedded[name](...args), `${name}(${JSON.stringify(args)})`).toEqual((rules as any)[name](...args));
    }
  });

  it("gives the commands' own messages", () => {
    expect(rules.idProblem("kr", "Bad Id")).toBe("'Bad Id' is not a key result id (lowercase words joined by hyphens)");
    expect(rules.idProblem("story", "PAY-CHK-12")).toBeUndefined();
    expect(rules.titleProblem("kr", " ")).toBe("A key result needs a title");
    expect(rules.titleProblem("story", "")).toBe("A story needs a title");
    expect(rules.numberProblem("checkin", NaN)).toBe("A check-in needs a numeric value");
    expect(rules.decisionProblem("maybe")).toBe("A review decision is one of continue, change, stop, complete");
    expect(rules.reasonProblem("")).toBe("A review needs a reason");
    expect(rules.krFieldProblems({ baseline: 1 }, "edit")).toEqual(["'baseline' can't be edited here"]);
    expect(rules.krFieldProblems({ direction: "sideways" }, "edit")).toEqual(["direction is up or down"]);
    expect(rules.krFieldProblems({ direction: "down" }, "edit")).toEqual([]);
    // A milestone needs no baseline or target; its steps are checked where the key result is made.
    expect(rules.krFieldProblems({ title: "A", owner: "Ana", by: "2027-01-01", kind: "milestone" }, "new")).toEqual([]);
    expect(rules.krFieldProblems({ title: "A", owner: "Ana", baseline: 1, target: 2, by: "2027-01-01", kind: "sideways" }, "new")).toEqual(["kind is number or milestone"]);
    expect(rules.krFieldProblems({ kind: "milestone" }, "edit")).toEqual(["'kind' can't be edited here"]);
    expect(rules.betFieldProblems({ outcome: "won" })).toEqual(["'outcome' can't be edited here"]);
    expect(rules.krFieldProblems({ ladders_up: 5 }, "edit")).toEqual(['ladders_up is words, such as "reconciliation revenue faster"']);
    expect(rules.betFieldProblems({ ladders_up: "a\nb" })).toEqual(["ladders_up is one line (no line breaks)"]);
    expect(rules.laddersProblem("   ")).toBeUndefined();
    // A title makes an id: lowercase words joined by hyphens, cut to 40 characters at a hyphen when it is longer.
    expect(rules.idFromTitle("Faster checkout!")).toBe("faster-checkout");
    expect(rules.idFromTitle("  --  ")).toBeUndefined();
    expect(rules.idFromTitle("Reduce the median number of days it takes the finance team to close each month")).toBe("reduce-the-median-number-of-days-it");
    expect(rules.idFromTitle("a".repeat(45))).toBe("a".repeat(40));
    // A bet's title is optional and one line: blank passes (it clears the title), a line break does not.
    expect(rules.betFieldProblems({ title: "   " })).toEqual([]);
    expect(rules.betFieldProblems({ title: "Two\nlines" })).toEqual(["A title is one line (no line breaks)"]);
    expect(rules.dateProblem("2026-02-30")).toBeTruthy();
    expect(rules.dateProblem("2026-13-40")).toBeTruthy();
    expect(rules.dateProblem("2027-02-28")).toBeUndefined();
    expect(rules.titleProblem("story", "Pay\nmore")).toBe("A title is one line (no line breaks)");
  });
});
