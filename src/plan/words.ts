// The plan's figures and read ages in words, shared by nikos plan status and the planning dashboard, so
// both say the same thing about the same bet.
import type { Figures, RepoRead } from "./delivery.js";

/** A code repo's name as the plan shows it: github.com repos by name alone, others with their host. */
export const repoLabel = (r: Pick<RepoRead, "host" | "repo">) => (r.host === "github.com" ? r.repo : `${r.host}/${r.repo}`);

/** The figures in words: "Building, 2 of 5 done (1 approved), 1 in progress". */
export function figuresText(f: Figures): string {
  if (f.total === 0) return `${f.status}, no stories in its maps yet`;
  const parts = [`${f.done} of ${f.total} done${f.approved ? ` (${f.approved} approved)` : ""}`];
  if (f.inProgress) parts.push(`${f.inProgress} in progress`);
  if (f.notCurrent) parts.push(`${f.notCurrent} not current with its feature`);
  if (f.noSummary) parts.push(`${f.noSummary} with no summary yet`);
  return `${f.status}, ${parts.join(", ")}`;
}

/** The read ages behind some figures, one per repo: " · acme/payments-web: read today (2026-11-10)". */
export function readsText(reads: RepoRead[]): string {
  return reads.length ? ` · ${reads.map((r) => `${repoLabel(r)}: ${r.age}`).join("; ")}` : "";
}
