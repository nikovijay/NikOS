// A bet's stop, read from its own card. Stopping a bet never changes the bets aimed at it: the
// rollout and the dashboard views flag them, and the owner reviews them (amendment, rule 10).

/** The date of a bet's latest stop review, when the bet is stopped; undefined otherwise. */
export function stopDate(meta: { outcome?: string; reviews?: { decision?: string; date?: unknown }[] }): string | undefined {
  if (meta.outcome !== "stopped") return undefined;
  return (meta.reviews ?? [])
    .filter((r) => r.decision === "stop")
    .map((r) => String(r.date ?? ""))
    .sort()
    .at(-1) || undefined;
}

/** The first ref a bet aims at (aligns_to, then its key results) that is in stopped, with the date it stopped. */
export function stoppedTarget(refs: string[], stopped: Map<string, string>): { target: string; date: string } | undefined {
  const target = refs.find((t) => stopped.has(t));
  return target ? { target, date: stopped.get(target)! } : undefined;
}

/** The words a bet aimed at a stopped bet shows, in the rollout and the views. */
export const stoppedNote = (sp: { target: string; date: string }) => `aligns to ${sp.target}, which was stopped on ${sp.date}`;
