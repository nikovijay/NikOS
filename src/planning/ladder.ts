// Ladders up: what a key result or bet points up to, before anyone has named the item above it. A
// person writes it as text ("reconciliation revenue faster"). This file finds the items it could link
// to, ranked by the words they share with the text, and accepts one: the link is written through the
// same checks a hand-written link gets, and the text goes. Text alone feeds no figure.
import { areaOf, loadBet, loadKr, type Area } from "./model.js";
import { alignsList, laddersOf, linkedOf } from "./levels.js";
import { setAligns, setBetKrs } from "./aligns.js";
import { editBet } from "./bets.js";
import { editKr } from "./krs.js";
import { areaAlignmentProblems, areaKrTargetProblems, chainOf, companyIds, RANK, type Entry } from "../plan/repo.js";

export type LadderKind = "kr" | "bet";
/** Candidates shown for one item. More than this and the list stops helping. */
const TOP = 3;

export interface Candidate {
  id: string;
  kind: "key result" | "bet";
  /** The area it sits in: company, departments/finance. */
  rel: string;
  title: string;
  /** The share of the text's words it has, 0 to 1. */
  score: number;
  shared: string[];
}

export interface LadderItemOut {
  id: string;
  kind: "key result" | "bet";
  rel: string;
  text: string;
}

const SMALL = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "our", "so", "the", "to", "we", "will", "with"]);

/** The words a text is matched on: lowercase, small words left out, plurals folded (ships to ship). */
export function wordsOf(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !SMALL.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  return [...new Set(words)];
}

/** An item's words to match on: its ladders_up text, else what it is about. */
function readItem(area: Area, kind: LadderKind, id: string): { data: any; text?: string; linked: boolean; about: string[] } {
  if (kind === "kr") {
    const data = loadKr(area.dir, id).data;
    return { data, text: laddersOf(data), linked: linkedOf("kr", data), about: [String(data.title ?? ""), String(data.objective ?? "")] };
  }
  const data = loadBet(area.dir, id).meta;
  return { data, text: laddersOf(data), linked: linkedOf("bet", data), about: [String(data.hypothesis ?? "")] };
}

const displayKind = (kind: LadderKind): "key result" | "bet" => (kind === "kr" ? "key result" : "bet");

/** The item named by id, anywhere in the company (ids are unique within it). */
export function findItem(repo: string, id: string): { kind: LadderKind; area: Area } {
  const hit = companyIds(repo).find((e) => (e.kind === "key result" || e.kind === "bet") && e.id === id);
  if (!hit) throw new Error(`No key result or bet called '${id}' in this company's plan. See them all with: nikos plan status`);
  return { kind: hit.kind === "key result" ? "kr" : "bet", area: hit.area };
}

/** The entries an item may link to. Each goes through the validator a hand-written link goes through. */
function poolOf(repo: string, kind: LadderKind, id: string, area: Area): Entry[] {
  return companyIds(repo).filter((e) => {
    if (e.id === id || (e.kind !== "key result" && e.kind !== "bet")) return false;
    // A key result aligns to key results above it. A bet aims at key results at its level or above, and aligns to bets above it.
    if (kind === "kr") return e.kind === "key result" && areaAlignmentProblems(area, [e.id], "kr").length === 0;
    return e.kind === "key result" ? areaKrTargetProblems(area, [e.id]).length === 0 : areaAlignmentProblems(area, [e.id], "bet").length === 0;
  });
}

/**
 * The items an item could link to, ranked by the share of its text's words they share. Ties go to
 * the items in its own chain of areas, then to the nearer level, then by id. Only the top few with
 * a shared word are returned. Nothing is written.
 */
export function ladderFor(repo: string, id: string): { kind: "key result" | "bet"; id: string; rel: string; text?: string; linked: boolean; candidates: Candidate[] } {
  const { kind, area } = findItem(repo, id);
  const item = readItem(area, kind, id);
  const words = wordsOf(item.text ?? item.about.join(" "));
  const chain = new Set(chainOf(area).map((a) => a.rel));
  const taken = new Set([...alignsList(item.data.aligns_to), ...(kind === "bet" ? [item.data.krs?.primary, ...alignsList(item.data.krs?.also)] : [])].filter(Boolean));
  const candidates = poolOf(repo, kind, id, area)
    .filter((e) => !taken.has(e.id))
    .map((e) => {
      const data = e.kind === "key result" ? loadKr(e.area.dir, e.id).data : loadBet(e.area.dir, e.id).meta;
      const about = e.kind === "key result" ? [e.id.replace(/-/g, " "), String(data.title ?? ""), String(data.objective ?? "")] : [e.id.replace(/-/g, " "), String(data.hypothesis ?? "")];
      const have = new Set(wordsOf(about.join(" ")));
      const shared = words.filter((w) => have.has(w));
      return { e, data, shared, score: words.length ? shared.length / words.length : 0 };
    })
    .filter((c) => c.shared.length > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(chain.has(b.e.area.rel)) - Number(chain.has(a.e.area.rel)) ||
        RANK[b.e.area.level] - RANK[a.e.area.level] ||
        a.e.id.localeCompare(b.e.id),
    )
    .slice(0, TOP)
    .map((c) => ({
      id: c.e.id,
      kind: c.e.kind as "key result" | "bet",
      rel: c.e.area.rel,
      title: String(c.e.kind === "key result" ? c.data.title ?? c.e.id : c.data.hypothesis ?? c.e.id),
      score: Math.round(c.score * 100) / 100,
      shared: c.shared,
    }));
  return { kind: displayKind(kind), id, rel: area.rel, ...(item.text ? { text: item.text } : {}), linked: item.linked, candidates };
}

/** Every key result and bet with text that no link backs yet: what plan ladder lists. */
export function unlinkedItems(repo: string): LadderItemOut[] {
  return companyIds(repo).flatMap((e) => {
    if (e.kind !== "key result" && e.kind !== "bet") return [];
    const kind: LadderKind = e.kind === "key result" ? "kr" : "bet";
    const item = readItem(e.area, kind, e.id);
    return item.text && !item.linked ? [{ id: e.id, kind: displayKind(kind), rel: e.area.rel, text: item.text }] : [];
  });
}

/**
 * Link an item to a candidate, in one write. A key result's aligns_to gets it. A bet gets a key result
 * in its krs (primary if empty, else also), or a bet above in its aligns_to. The same checks as a
 * hand-written link run, and the text is cleared by the link's write. root is the item's area folder.
 */
export function acceptLadder(root: string, kind: LadderKind, id: string, candidate: string, expect?: string): string {
  const area = areaOf(root);
  if (!area) throw new Error("Accepting a ladder needs a planning area: run it in the plan");
  const hit = companyIds(area.repo).find((e) => (e.kind === "key result" || e.kind === "bet") && e.id === candidate);
  if (!hit) throw new Error(`There's no key result or bet called '${candidate}' in this company's plan`);
  if (kind === "kr") {
    const current = alignsList(loadKr(root, id).data.aligns_to);
    if (current.includes(candidate)) throw new Error(`${id} already aligns to ${candidate}`);
    return setAligns(root, "kr", id, [...current, candidate], expect);
  }
  const meta = loadBet(root, id).meta;
  if (hit.kind === "key result") {
    const also = alignsList(meta.krs?.also);
    if (meta.krs?.primary === candidate || also.includes(candidate)) throw new Error(`${id} already aims at ${candidate}`);
    const krs = meta.krs?.primary ? { primary: meta.krs.primary, also: [...also, candidate] } : { primary: candidate, also };
    return setBetKrs(root, id, krs, expect);
  }
  const current = alignsList(meta.aligns_to);
  if (current.includes(candidate)) throw new Error(`${id} already aligns to ${candidate}`);
  return setAligns(root, "bet", id, [...current, candidate], expect);
}

/** Clear an item's text, once a link is written or when it's no longer wanted. */
export function clearLadder(root: string, kind: LadderKind, id: string, expect?: string): string {
  const data = kind === "kr" ? loadKr(root, id).data : loadBet(root, id).meta;
  if (!laddersOf(data)) throw new Error(`${id} has no ladders_up text to clear`);
  return kind === "kr" ? editKr(root, id, { ladders_up: "" }, expect) : editBet(root, id, { ladders_up: "" }, expect);
}
