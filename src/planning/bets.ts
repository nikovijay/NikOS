// Bet cards in planning/<area>/bets/<id>.md: what we believe, the key results it should move,
// when we review it, and every review decision since.
import { join } from "node:path";
import { BET_ID } from "../lib/bets.js";
import { areaOf, betText, checkBet, describeErrors, loadBet, paths, today, writePlanning } from "./model.js";
import { newIdFor, takenProblem } from "../plan/repo.js";
import { alignmentProblems, alignsValue, krTargetProblems } from "./levels.js";
import { betFieldProblems, dateProblem, titleProblem } from "./rules.js";

export interface BetInput {
  /** The bet's id. Without it, the id is made from the title (see newIdFor). */
  id?: string;
  /** What the bet is, in a few words. Optional: the id names the bet without it. */
  title?: string;
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
  /** Free text: what this ladders up to, until a link is written. Not with alignsTo, primary or also. */
  laddersUp?: string;
  confidence?: "low" | "medium" | "high";
  dependencies?: string[];
  evidence?: string;
}

function checked(meta: any): any {
  if (!checkBet(meta)) throw new Error(`Not a valid bet card: ${describeErrors(checkBet.errors).join("; ")}`);
  return meta;
}

/**
 * Write planning/<area>/bets/<id>.md. Never overwrites an existing bet. With no id, the id is made from the
 * title, with -2 or -3 when another bet or area has that id. An id given is used as it is.
 */
export function newBet(input: BetInput, root: string): string {
  const area = areaOf(root);
  const title = input.title?.trim() || undefined;
  if (title) {
    const titled = titleProblem("bet", title);
    if (titled) throw new Error(titled);
  }
  const given = input.id?.trim() || undefined;
  if (!given && !title) throw new Error("A bet needs a title");
  const id = given ?? newIdFor(area?.repo, title);
  if (!id) throw new Error(`'${title}' has no letters or numbers to make an id from: use a title with some letters or numbers, or give an id`);
  if (!BET_ID.test(id)) throw new Error(`'${id}' is not a bet id (lowercase words joined by hyphens, e.g. faster-checkout)`);
  if (!input.owner?.trim()) throw new Error("A bet needs an owner");
  if (!input.hypothesis?.trim()) throw new Error("A bet needs a hypothesis");
  const reviewed = dateProblem(input.reviewOn);
  if (reviewed) throw new Error(input.reviewOn ? `The review date ${reviewed}` : "A bet needs a review date (YYYY-MM-DD)");
  const taken = area && takenProblem(area.repo, id);
  if (taken) throw new Error(taken);
  const aligns = [...new Set((input.alignsTo ?? []).filter(Boolean))];
  const problem = alignmentProblems(root, aligns, "bet")[0] ?? krTargetProblems(root, [input.primary, ...(input.also ?? [])].filter((r): r is string => !!r))[0];
  if (problem) throw new Error(problem);
  const ladders = input.laddersUp?.trim() || undefined;
  const laddersProblemText = betFieldProblems({ ladders_up: ladders })[0];
  if (laddersProblemText) throw new Error(laddersProblemText);
  if (ladders && (aligns.length || input.primary || input.also?.length)) throw new Error("Give a link (--aligns-to or --kr) or the text (--ladders-up), not both");
  const meta = checked({
    id,
    ...(title ? { title } : {}),
    owner: input.owner.trim(),
    ...(input.team ? { team: input.team } : {}),
    hypothesis: input.hypothesis.trim(),
    krs: { ...(input.primary ? { primary: input.primary } : {}), also: input.also ?? [] },
    ...(aligns.length ? { aligns_to: alignsValue(aligns) } : {}),
    ...(ladders ? { ladders_up: ladders } : {}),
    ...(input.starts ? { starts: input.starts } : {}),
    review_on: input.reviewOn,
    ...(input.deadline ? { deadline: input.deadline } : {}),
    confidence: input.confidence ?? "medium",
    dependencies: input.dependencies ?? [],
    outcome: "open",
    reviews: [],
  });
  const body = `\n## Why we think so\n${input.evidence?.trim() || "The evidence behind the hypothesis: what we saw, and where."}\n`;
  return writePlanning(root, join(paths(root).bets, `${id}.md`), betText(meta, body), { create: true });
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
  if (!r.reason?.trim()) throw new Error("A review needs a reason");
  if (r.decision === "complete" && r.outcome !== "won" && r.outcome !== "lost") {
    throw new Error("Completing a bet needs its outcome from the key result evidence: won or lost");
  }
  const bet = loadBet(root, id);
  const meta = structuredClone(bet.meta);
  const outcome = r.decision === "stop" ? "stopped" : r.decision === "complete" ? r.outcome : undefined;
  meta.reviews = [...(meta.reviews ?? []), { date: r.date ?? today(), decision: r.decision, reason: r.reason.trim(), ...(outcome ? { outcome } : {}) }];
  if (outcome) meta.outcome = outcome;
  return writePlanning(root, join(paths(root).bets, `${id}.md`), betText(checked(meta), bet.body), { expect: r.expect ?? bet.hash });
}

const EDITABLE = ["title", "owner", "team", "hypothesis", "starts", "review_on", "deadline", "confidence", "dependencies", "outcome", "ladders_up"] as const;

/** Change a bet's fields (not its reviews or id). `expect` is the hash of the version being edited. */
export function editBet(root: string, id: string, fields: Record<string, unknown>, expect?: string): string {
  // The same rules the dashboard and bet.edit apply, so the CLI refuses an empty owner the same way.
  const { outcome: _outcome, ...rest } = fields;
  const problem = betFieldProblems(rest)[0];
  if (problem) throw new Error(problem);
  const bet = loadBet(root, id);
  const meta = structuredClone(bet.meta);
  for (const [k, raw] of Object.entries(fields)) {
    if (!(EDITABLE as readonly string[]).includes(k)) throw new Error(`'${k}' can't be edited here`);
    const v = (k === "ladders_up" || k === "title") && typeof raw === "string" ? raw.trim() : raw;
    if (v === "" || v === null) delete meta[k];
    else meta[k] = v;
  }
  return writePlanning(root, join(paths(root).bets, `${id}.md`), betText(checked(meta), bet.body), { expect: expect ?? bet.hash });
}
