// How a bet link in a storymap is read: a bet of this plan, a bet of another plan (not counted), or
// something that names no bet here. Pure: no files, no git.
import { describe, expect, it } from "vitest";
import { classifyBet } from "../src/plan/delivery";

const BETS = new Set(["faster-checkout", "checkout-goal"]);
const SELF = "acme/company-plan";

describe("classifyBet", () => {
  it("reads a bare id as a bet of this plan when the plan has it", () => {
    expect(classifyBet("faster-checkout", SELF, BETS)).toEqual({ kind: "bet", bet: "faster-checkout" });
  });

  it("reports a bare id that the plan doesn't have as unknown, and names it", () => {
    const link = classifyBet("one-tap-pay", SELF, BETS);
    expect(link).toMatchObject({ kind: "unknown" });
    expect(link.kind === "unknown" && link.message).toContain("no bet called one-tap-pay");
  });

  it("reads <this plan's repo>#<id> as the same bet, without regard to case", () => {
    expect(classifyBet("Acme/Company-Plan#faster-checkout", SELF, BETS)).toEqual({ kind: "bet", bet: "faster-checkout" });
  });

  it("reports <this plan's repo>#<id> for an id the plan doesn't have as unknown", () => {
    expect(classifyBet("acme/company-plan#nope", SELF, BETS)).toMatchObject({ kind: "unknown" });
  });

  it("reads a bet of another repo as elsewhere: it is not counted here", () => {
    const link = classifyBet("acme/other-plan#faster-checkout", SELF, BETS);
    expect(link).toMatchObject({ kind: "elsewhere" });
    expect(link.kind === "elsewhere" && link.message).toContain("another plan");
  });

  it("can't match a qualified link when the plan has no origin, and says so, without failing", () => {
    const link = classifyBet("acme/company-plan#faster-checkout", undefined, BETS);
    expect(link).toMatchObject({ kind: "unknown" });
    expect(link.kind === "unknown" && link.message).toContain("no origin");
  });

  it("treats an empty link as no link, and a malformed one as unknown", () => {
    expect(classifyBet("  ", SELF, BETS)).toEqual({ kind: "none" });
    expect(classifyBet("Faster Checkout", SELF, BETS)).toMatchObject({ kind: "unknown" });
  });
});
