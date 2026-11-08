// The dashboard's pages as data: what the OKRs and bets page, the OKR ladder and the group's
// bets and story maps page show. Pure functions over planningData's output: they read no files and
// fetch nothing. The page draws them, and the words here are the words it shows. Links, not totals:
// no view adds up progress from one plan into another.

import { stopDate, stoppedNote, stoppedTarget } from "./stops.js";

/** A key result or bet in the plan above, as the page links to it. */
export interface UpRef {
  ref: string;
  repo: string;
  id: string;
  title: string;
  found: boolean;
  /** Which of this plan's items point at it. */
  from: string[];
  /** The plan the copy came from, by name when its plan.yaml has one. */
  plan?: string;
  /** Share of the way from baseline to target, from the copy's latest check-in. */
  progress?: number | null;
}

/** Share of the way from baseline to target, or null when the numbers don't allow it. */
function progressOf(kr: any): number | null {
  if (!kr || typeof kr.baseline !== "number" || typeof kr.target !== "number") return null;
  if (typeof kr.progress === "number") return kr.progress;
  const last = (kr.checkins ?? []).at(-1)?.value;
  const v = typeof last === "number" ? last : kr.baseline;
  return kr.target === kr.baseline ? 1 : (v - kr.baseline) / (kr.target - kr.baseline);
}

/** A bet's id as a title: smart-retries reads Smart retries. */
export const betTitle = (id: string) => (id ? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " ") : id);

/** The name of the plan a repo's copy holds, else the repo path. */
const planName = (data: any, repo: string) => (data.upstream ?? []).find((u: any) => u.repo === repo)?.name ?? repo;

export const NOTE = {
  noneAbove: "Nothing above this plan is aligned to yet.",
  noObjective: "No objective",
  ladder: "Highlighted: the path from this plan's key results up to the company.",
  okrsFoot: "Links, not totals. Each figure comes from its own plan.",
  groupFoot: "Status is from each team's last nikos map status run on this machine (fetched {date}). Nothing is fetched on this page.",
  groupNotFetched: "Status is from each team's last nikos map status run on this machine. No team has been read yet. Nothing is fetched on this page.",
  emptyAbove: "No company key results loaded. Run nikos planning sync to refresh the copies.",
  topLevel: "This is the top plan: nothing sits above it.",
  noOrigin: "This plan has no origin remote, so group bets aligned to its bets can't be matched here. Add the origin remote, then sync again.",
  onChain: "On this plan's chain",
};

/** Upstream key results this plan aligns to, from each of its key results. */
function aboveRefs(data: any): UpRef[] {
  const out = new Map<string, UpRef>();
  for (const k of data.krs ?? []) {
    for (const a of k.aligned ?? []) {
      if (!a) continue;
      const cur = out.get(a.ref) ?? { ref: a.ref, repo: a.repo, id: a.ref.split("#")[1] ?? "", title: a.kr?.title ?? "", found: !!a.found, from: [] as string[], plan: planName(data, a.repo), progress: progressOf(a.kr) };
      cur.from.push(k.id);
      out.set(a.ref, cur);
    }
  }
  return [...out.values()];
}

/** The OKRs and bets page: key results above and by objective, bets, the bets above, and group bets below. */
export function okrsAndBets(data: any) {
  const above = aboveRefs(data);
  const own = data.plan?.repo;
  // Every stopped bet this page can see, keyed as refs are written: the copies above, this plan's own, and the plans below.
  const stopped = new Map<string, string>();
  for (const u of data.upstream ?? []) for (const b of u.bets ?? []) {
    const d = stopDate(b);
    if (d) stopped.set(`${u.repo}#${b.id}`, d);
  }
  for (const b of data.bets ?? []) {
    const d = own ? stopDate(b) : undefined;
    if (own && d) stopped.set(`${own}#${b.id}`, d);
  }
  for (const p of data.downstream?.plans ?? []) for (const b of p.bets ?? []) if (b.stoppedOn) stopped.set(b.ref, b.stoppedOn);
  const byObjective = new Map<string, { objective: string; krs: any[] }>();
  for (const k of data.krs ?? []) {
    const objective = String(k.objective || "").trim() || NOTE.noObjective;
    if (!byObjective.has(objective)) byObjective.set(objective, { objective, krs: [] });
    byObjective.get(objective)!.krs.push({ id: k.id, title: k.title, aligned: (k.aligned ?? []).filter(Boolean).map((a: any) => a.ref), progress: progressOf(k) });
  }
  const bets = (data.bets ?? []).map((b: any) => {
    const hit = stoppedTarget([...(b.aligns_to ?? []), ...[b.krs?.primary, ...(b.krs?.also ?? [])].filter(Boolean)], stopped);
    return {
      id: b.id,
      title: betTitle(b.id),
      tag: (b.aligns_to ?? []).length ? "aligned" : "own",
      alignsTo: b.aligns_to ?? [],
      krs: [b.krs?.primary, ...(b.krs?.also ?? [])].filter(Boolean),
      outcome: b.outcome,
      delivery: b.delivery?.text ?? "",
      // A bet aimed at a stopped bet is flagged; nothing here changes it (rule 10).
      ...(hit ? { stoppedParent: hit, note: stoppedNote(hit) } : {}),
    };
  });
  // Bets above this plan's bets align to, looked up in the synced copies.
  const betsAbove = new Map<string, { ref: string; repo: string; id: string; title: string; plan: string; found: boolean; outcome?: string; stoppedOn?: string; from: string[] }>();
  for (const b of data.bets ?? []) {
    for (const ref of b.aligns_to ?? []) {
      const [repo, id] = ref.split("#");
      const copy = (data.upstream ?? []).find((u: any) => u.repo === repo);
      const hit = copy?.bets?.find((x: any) => x.id === id);
      const cur = betsAbove.get(ref) ?? { ref, repo, id, title: betTitle(id), plan: planName(data, repo), found: !!hit, ...(hit ? { outcome: hit.outcome } : {}), ...(stopped.get(ref) ? { stoppedOn: stopped.get(ref) } : {}), from: [] as string[] };
      cur.from.push(b.id);
      betsAbove.set(ref, cur);
    }
  }
  // Group bets aligned to one of this plan's bets: delivery only, from each group's own state (D4).
  const hasDownstreamBets = (data.downstream?.plans ?? []).some((p: any) => (p.bets ?? []).length);
  const groupBets: { plan: string; repo?: string; id: string; aligns_to: string; delivery: string; note?: string }[] = [];
  for (const p of data.downstream?.plans ?? []) {
    for (const gb of p.bets ?? []) {
      for (const ref of gb.aligns_to ?? []) {
        const id = ref.split("#")[1];
        if (own && ref.startsWith(`${own}#`) && (data.bets ?? []).some((b: any) => b.id === id)) {
          const hit = stoppedTarget([...(gb.aligns_to ?? []), ...(gb.krs ?? [])], stopped);
          groupBets.push({ plan: p.name, ...(p.repo ? { repo: p.repo } : {}), id: gb.id, aligns_to: ref, delivery: gb.delivery, ...(hit ? { note: stoppedNote(hit) } : {}) });
        }
      }
    }
  }
  // The plan above, by name: every reference here is to the plan directly above.
  const aboveRepo = above[0]?.repo ?? [...betsAbove.values()][0]?.repo ?? data.upstream?.[0]?.repo;
  return {
    level: data.plan?.level ?? "",
    name: data.plan?.name ?? "",
    period: data.plan?.period ?? "",
    aboveName: aboveRepo ? planName(data, aboveRepo) : "",
    noneAbove: above.length ? "" : NOTE.noneAbove,
    above,
    byObjective: [...byObjective.values()],
    bets,
    betsAbove: [...betsAbove.values()],
    groupBets,
    groupBetsNote: !own && hasDownstreamBets ? NOTE.noOrigin : "",
    foot: NOTE.okrsFoot,
  };
}

/**
 * The OKR ladder: every key result of the plans above (from their copies) in one column, this
 * plan's in the other, and the chain between: the ones this plan's key results align to are marked.
 */
export function okrLadder(data: any) {
  const chain = aboveRefs(data);
  const onChain = new Set(chain.map((a) => a.ref));
  const copies: UpRef[] = (data.upstream ?? []).flatMap((u: any) =>
    (u.krs ?? []).map((k: any) => ({ ref: `${u.repo}#${k.id}`, repo: u.repo, id: k.id, title: k.title ?? "", found: true, from: [] as string[], plan: u.name ?? u.repo, progress: progressOf(k) })),
  );
  const seen = new Set(copies.map((c) => c.ref));
  // A reference that doesn't resolve in a copy stays in the column, so a broken link still shows.
  const above = [...copies, ...chain.filter((c) => !seen.has(c.ref))];
  const own = (data.krs ?? []).map((k: any) => {
    const aligned = (k.aligned ?? []).filter(Boolean).map((a: any) => a.ref);
    return { id: k.id, title: k.title, aligned, onChain: aligned.length > 0, progress: progressOf(k) };
  });
  return {
    above: above.map((a) => ({ ...a, onChain: onChain.has(a.ref), note: onChain.has(a.ref) ? NOTE.onChain : "" })),
    own,
    name: data.plan?.name ?? "",
    aboveName: data.upstream?.[0] ? planName(data, data.upstream[0].repo) : "",
    emptyAbove: above.length ? "" : data.plan?.level === "company" ? NOTE.topLevel : NOTE.emptyAbove,
    foot: NOTE.ladder,
  };
}

/** The group page: each bet with its aligned-to and delivery, and every story map with its parts and story rows. */
export function betsAndStoryMaps(data: any) {
  const fetched: string | null = data.teamIndex?.fetched ?? null;
  return {
    bets: (data.bets ?? []).map((b: any) => ({
      id: b.id,
      hypothesis: b.hypothesis,
      outcome: b.outcome,
      delivery: b.delivery?.text ?? "",
      alignsTo: b.aligns_to ?? [],
    })),
    maps: (data.maps ?? []).map((m: any) => ({
      id: m.id,
      bet: m.bet ?? null,
      key: m.key,
      title: m.title,
      parts: m.parts ?? [],
      stories: m.stories ?? [],
    })),
    foot: fetched ? NOTE.groupFoot.replace("{date}", fetched) : NOTE.groupNotFetched,
  };
}
