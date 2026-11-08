// The rules the dashboard and the commands share. No imports and no module-level values: the
// dashboard page embeds every export as source text (fn.toString()), so the page checks fields the
// same way the commands do. A rule may call another one in this file, so the page embeds the whole
// module together (ui.ts does). Messages match the commands' own, word for word.

/** An id of the given kind, or the message saying why it can't be one. */
export function idProblem(kind: "kr" | "bet" | "story" | "activity" | "step" | "release" | "map" | "team", id: string): string | undefined {
  if (typeof id !== "string") return "'" + String(id) + "' is not an id";
  const words = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  if (kind === "kr") return words.test(id) ? undefined : "'" + id + "' is not a key result id (lowercase words joined by hyphens)";
  if (kind === "bet") return words.test(id) ? undefined : "'" + id + "' is not a bet id (lowercase words joined by hyphens, e.g. faster-checkout)";
  if (kind === "activity") return words.test(id) ? undefined : "'" + id + "' is not an activity id (lowercase words joined by hyphens)";
  if (kind === "step") return words.test(id) ? undefined : "'" + id + "' is not a step id (lowercase words joined by hyphens)";
  if (kind === "map") return words.test(id) ? undefined : "'" + id + "' is not a map id (lowercase words joined by hyphens)";
  if (kind === "release") return /^[0-9]+$/.test(id) ? undefined : "'" + id + "' is not a release number";
  if (kind === "story") return /^[A-Z][A-Z0-9]{0,9}(-[A-Z][A-Z0-9]{0,9})?-[0-9]+$/.test(id) ? undefined : "'" + id + "' is not a story id (e.g. HT-1, or PAY-CHK-12 in a group)";
  if (kind === "team") {
    const path = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/.test(id) && !/(^|\/)\.{1,2}(\/|$)/.test(id);
    return id === "." || path ? undefined : "'" + id + "' is not a team repo path (owner/repo, or . when the group repo is its own team)";
  }
  return "'" + id + "' is not a kind of id nikOS knows";
}

/** Undefined for a YYYY-MM-DD date, or a message the caller can build its own sentence from. */
export function dateProblem(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "is not a date (YYYY-MM-DD)";
  // A real calendar date: 2026-02-30 and 2026-13-40 are refused, not just the shape.
  const d = new Date(v + "T00:00:00Z");
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? "is not a date (YYYY-MM-DD)" : undefined;
}

/** Undefined for a finite number. */
export function numberProblem(label: string, v: unknown): string | undefined {
  if (typeof v === "number" && isFinite(v)) return undefined;
  return label === "checkin" ? "A check-in needs a numeric value" : "A " + label + " needs a numeric value";
}

/** Undefined for one of the four review decisions. */
export function decisionProblem(v: unknown): string | undefined {
  return v === "continue" || v === "change" || v === "stop" || v === "complete" ? undefined : "A review decision is one of continue, change, stop, complete";
}

/** Undefined for a review reason with some text in it. */
export function reasonProblem(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? undefined : "A review needs a reason (--why)";
}

/** Undefined for a title with some text in it, with the message the kind of thing needs. */
export function titleProblem(label: string, v: unknown): string | undefined {
  // A title is one line: a line break would turn the rest of it into Gherkin or into a second line of the file.
  if (typeof v === "string" && v.trim() !== "" && !/[\r\n]/.test(v)) return undefined;
  if (typeof v === "string" && /[\r\n]/.test(v)) return "A title is one line (no line breaks)";
  if (label === "kr") return "A key result needs a title (--title)";
  if (label === "story") return "A story needs a title";
  if (label === "activity") return "An activity needs a title";
  if (label === "step") return "A step needs a title";
  if (label === "release") return "A release needs a title";
  return "A " + label + " needs a title";
}

/**
 * What's wrong with a key result's fields. new: all required fields must be there. edit: only the
 * fields given are checked, and an empty optional field deletes it. Baseline and target are fixed
 * once written (the target moves with kr target), so edit refuses them.
 */
export function krFieldProblems(fields: Record<string, unknown>, mode: "new" | "edit"): string[] {
  const out: string[] = [];
  const editable = ["title", "owner", "by", "unit", "objective", "stale_after_days"];
  if (mode === "edit") {
    for (const k of Object.keys(fields)) if (editable.indexOf(k) < 0) out.push("'" + k + "' can't be edited here");
  }
  const has = (k: string) => mode === "new" || Object.prototype.hasOwnProperty.call(fields, k);
  if (has("title")) {
    const t = titleProblem("kr", fields.title);
    if (t) out.push(t);
  }
  if (mode === "new" || has("owner")) {
    if (typeof fields.owner !== "string" || fields.owner.trim() === "") out.push("A key result needs an owner (--owner)");
  }
  if (mode === "new") {
    if (typeof fields.baseline !== "number" || !isFinite(fields.baseline) || typeof fields.target !== "number" || !isFinite(fields.target)) {
      out.push("A key result needs a numeric --baseline and --target");
    }
  }
  if (has("by")) {
    if (dateProblem(fields.by)) out.push("A key result needs a date (--by YYYY-MM-DD)");
  }
  return out;
}

/**
 * What's wrong with a bet's fields, as newBet and editBet say it. Empty required fields refuse;
 * an empty optional field (or null) deletes it. outcome isn't editable here: only bet review sets it.
 */
export function betFieldProblems(fields: Record<string, unknown>): string[] {
  const out: string[] = [];
  const editable = ["owner", "team", "hypothesis", "starts", "review_on", "deadline", "confidence", "dependencies"];
  for (const k of Object.keys(fields)) if (editable.indexOf(k) < 0) out.push("'" + k + "' can't be edited here");
  const blank = (v: unknown) => v === "" || v === null || v === undefined;
  if (Object.prototype.hasOwnProperty.call(fields, "owner") && (typeof fields.owner !== "string" || fields.owner.trim() === "")) out.push("A bet needs an owner (--owner)");
  if (Object.prototype.hasOwnProperty.call(fields, "hypothesis") && (typeof fields.hypothesis !== "string" || fields.hypothesis.trim() === "")) out.push("A bet needs a hypothesis (--hypothesis)");
  if (Object.prototype.hasOwnProperty.call(fields, "review_on") && (blank(fields.review_on) || dateProblem(fields.review_on))) out.push("A bet needs a review date (--review YYYY-MM-DD)");
  for (const k of ["starts", "deadline"]) {
    if (Object.prototype.hasOwnProperty.call(fields, k) && !blank(fields[k]) && dateProblem(fields[k])) out.push(k + " is not a date (YYYY-MM-DD)");
  }
  if (Object.prototype.hasOwnProperty.call(fields, "confidence") && !blank(fields.confidence) && ["low", "medium", "high"].indexOf(fields.confidence as string) < 0) {
    out.push("confidence is one of low, medium, high");
  }
  return out;
}
