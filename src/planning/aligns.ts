// Where a key result or bet points up: its aligns_to references, and a bet's krs. Each reference
// is checked against the synced copies of the plan above, the same way newKr and newBet check it.
import { join } from "node:path";
import { betText, checkBet, checkKr, describeErrors, krText, loadBet, loadKr, paths, writePlanning } from "./model.js";
import { alignmentProblems, alignsValue, krTargetProblems } from "./levels.js";

/** Replace a key result's or bet's aligns_to with refs (none removes it). expect is the hash it was loaded at. */
export function setAligns(root: string, kind: "kr" | "bet", id: string, refs: string[], expect?: string): string {
  const list = [...new Set(refs.filter(Boolean))];
  const problem = alignmentProblems(root, list, kind)[0];
  if (problem) throw new Error(problem);
  if (kind === "kr") {
    const kr = loadKr(root, id);
    const data = structuredClone(kr.data);
    // A link written replaces the text: the text was only standing in for it.
    if (list.length) {
      data.aligns_to = alignsValue(list);
      delete data.ladders_up;
    } else delete data.aligns_to;
    if (!checkKr(data)) throw new Error(`Not a valid key result: ${describeErrors(checkKr.errors).join("; ")}`);
    return writePlanning(root, join(paths(root).krs, `${id}.yaml`), krText(data), { expect: expect ?? kr.hash });
  }
  const bet = loadBet(root, id);
  const meta = structuredClone(bet.meta);
  if (list.length) {
    meta.aligns_to = alignsValue(list);
    delete meta.ladders_up;
  } else delete meta.aligns_to;
  if (!checkBet(meta)) throw new Error(`Not a valid bet card: ${describeErrors(checkBet.errors).join("; ")}`);
  return writePlanning(root, join(paths(root).bets, `${id}.md`), betText(meta, bet.body), { expect: expect ?? bet.hash });
}

/**
 * Set a bet's key results: primary (one) and also (several). Each one in this plan must exist;
 * a reference to another plan (repo#id) is kept as it is, since it can't be checked here.
 */
export function setBetKrs(root: string, id: string, krs: { primary?: string; also?: string[] }, expect?: string): string {
  const primary = krs.primary?.trim() || undefined;
  const also = [...new Set((krs.also ?? []).map((r) => r.trim()).filter(Boolean))];
  if (primary && also.includes(primary)) throw new Error(`${primary} is both primary and also`);
  // A key result may be in another area of the company: krTargetProblems checks it there.
  const problem = krTargetProblems(root, [primary, ...also].filter((r): r is string => !!r))[0];
  if (problem) throw new Error(problem);
  const bet = loadBet(root, id);
  const meta = structuredClone(bet.meta);
  meta.krs = { ...(primary ? { primary } : {}), also };
  if (primary || also.length) delete meta.ladders_up;
  if (!checkBet(meta)) throw new Error(`Not a valid bet card: ${describeErrors(checkBet.errors).join("; ")}`);
  return writePlanning(root, join(paths(root).bets, `${id}.md`), betText(meta, bet.body), { expect: expect ?? bet.hash });
}
