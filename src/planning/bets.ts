// Bet cards in planning/bets/<id>.md: what we believe, the key results it should move,
// when we review it, and every review decision since.
import { join } from "node:path";
import { BET_ID } from "../lib/bets.js";
import { DATE, betText, checkBet, describeErrors, loadBet, paths, today, writePlanning } from "./model.js";
import { alignmentProblems, alignsValue } from "./levels.js";

export interface BetInput {
  id: string;
  owner: string;
  hypothesis: string;
  reviewOn: string;
  team?: string;
  starts?: string;
  deadline?: string;
  primary?: string;
  also?: string[];
  /** The bets in the plan directly above that this one aligns to: none, one or several. */
  alignsTo?: string[];
  confidence?: "low" | "medium" | "high";
  dependencies?: string[];
  evidence?: string;
}

function checked(meta: any): any {
  if (!checkBet(meta)) throw new Error(`Not a valid bet card: ${describeErrors(checkBet.errors).join("; ")}`);
  return meta;
}

/** Write planning/bets/<id>.md. Never overwrites an existing bet. */
export function newBet(input: BetInput, root: string): string {
  if (!BET_ID.test(input.id)) throw new Error(`'${input.id}' is not a bet id (lowercase words joined by hyphens, e.g. faster-checkout)`);
  if (!input.owner?.trim()) throw new Error("A bet needs an owner (--owner)");
  if (!input.hypothesis?.trim()) throw new Error("A bet needs a hypothesis (--hypothesis)");
  if (!DATE.test(input.reviewOn ?? "")) throw new Error("A bet needs a review date (--review YYYY-MM-DD)");
  const aligns = [...new Set((input.alignsTo ?? []).filter(Boolean))];
  const problem = alignmentProblems(root, aligns, "bet")[0];
  if (problem) throw new Error(problem);
  const meta = checked({
    id: input.id,
    owner: input.owner.trim(),
    ...(input.team ? { team: input.team } : {}),
    hypothesis: input.hypothesis.trim(),
    krs: { ...(input.primary ? { primary: input.primary } : {}), also: input.also ?? [] },
    ...(aligns.length ? { aligns_to: alignsValue(aligns) } : {}),
    ...(input.starts ? { starts: input.starts } : {}),
    review_on: input.reviewOn,
    ...(input.deadline ? { deadline: input.deadline } : {}),
    confidence: input.confidence ?? "medium",
    dependencies: input.dependencies ?? [],
    outcome: "open",
    reviews: [],
  });
  const body = `\n## Why we think so\n${input.evidence?.trim() || "The evidence behind the hypothesis: what we saw, and where."}\n`;
  return writePlanning(root, join(paths(root).bets, `${input.id}.md`), betText(meta, body), { create: true });
}

export const DECISIONS = ["continue", "change", "stop", "complete"] as const;
export type Decision = (typeof DECISIONS)[number];

/**
 * Add a dated review decision to a bet. Earlier reviews are kept as they are.
 * stop sets the outcome to stopped; complete needs the outcome the evidence shows (won or lost).
 */
export function reviewBet(
  root: string,
  id: string,
  r: { decision: Decision; reason: string; outcome?: "won" | "lost"; date?: string; expect?: string },
): string {
  if (!DECISIONS.includes(r.decision)) throw new Error(`A review decision is one of ${DECISIONS.join(", ")}`);
  if (!r.reason?.trim()) throw new Error("A review needs a reason (--why)");
  if (r.decision === "complete" && r.outcome !== "won" && r.outcome !== "lost") {
    throw new Error("Completing a bet needs its outcome from the key result evidence: --outcome won or --outcome lost");
  }
  const bet = loadBet(root, id);
  const meta = structuredClone(bet.meta);
  const outcome = r.decision === "stop" ? "stopped" : r.decision === "complete" ? r.outcome : undefined;
  meta.reviews = [...(meta.reviews ?? []), { date: r.date ?? today(), decision: r.decision, reason: r.reason.trim(), ...(outcome ? { outcome } : {}) }];
  if (outcome) meta.outcome = outcome;
  return writePlanning(root, join(paths(root).bets, `${id}.md`), betText(checked(meta), bet.body), { expect: r.expect ?? bet.hash });
}

const EDITABLE = ["owner", "team", "hypothesis", "starts", "review_on", "deadline", "confidence", "dependencies", "outcome"] as const;

/** Change a bet's fields (not its reviews or id). `expect` is the hash of the version being edited. */
export function editBet(root: string, id: string, fields: Record<string, unknown>, expect?: string): string {
  const bet = loadBet(root, id);
  const meta = structuredClone(bet.meta);
  for (const [k, v] of Object.entries(fields)) {
    if (!(EDITABLE as readonly string[]).includes(k)) throw new Error(`'${k}' can't be edited here`);
    if (v === "" || v === null) delete meta[k];
    else meta[k] = v;
  }
  return writePlanning(root, join(paths(root).bets, `${id}.md`), betText(checked(meta), bet.body), { expect: expect ?? bet.hash });
}
