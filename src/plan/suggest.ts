// What to do next in a planning repo, for one area (or the company): its key results and bets, the
// ones due, the key results gone stale, and any delivery warnings. The same shape as a story map's
// suggestion, so every agent offers the same menu for the same situation.
import type { Option, Suggestion } from "../commands/suggest.js";
import { isStale } from "../planning/krs.js";
import { count } from "../lib/project.js";
import { betIds, krIds, loadBet, loadKr, today, type Area } from "../planning/model.js";
import { planDeliveries } from "./delivery.js";
import { deliveryIssues } from "./cli.js";
import { areaFile, companyYear } from "./repo.js";

const MAX = 4;

/** The suggestion for one area of a planning repo. */
export function suggestPlan(repo: string, area: Area): Suggestion {
  const file = areaFile(area) ?? {};
  const krs = krIds(area.dir);
  const bets = betIds(area.dir);
  const stale = krs.flatMap((id) => {
    try {
      const k = loadKr(area.dir, id).data;
      return isStale(k) ? [String(k.title ?? id)] : [];
    } catch {
      return [];
    }
  });
  const due = bets.flatMap((id) => {
    try {
      const m = loadBet(area.dir, id).meta;
      return m.outcome === "open" && m.review_on && String(m.review_on) <= today() ? [{ id, on: String(m.review_on) }] : [];
    } catch {
      return [];
    }
  });
  const warnings = deliveryIssues(repo, planDeliveries(repo)).filter((i) => i.warning).length;

  const options: Option[] = [];
  if (due.length) {
    options.push({
      label: due.length === 1 ? `Review the ${due[0].id} bet (due ${due[0].on})` : `Review ${due.length} bets that are due`,
      do: `Ask for each bet's review: continue, change, stop or complete, with the reason. Then record it with nikos plan bet review <id> <decision> --why "<reason>".`,
    });
  }
  if (stale.length) {
    options.push({
      label: stale.length === 1 ? `Check in on "${stale[0]}"` : `Check in on ${stale.length} key results`,
      do: "Ask for each key result's latest value, then record it with nikos plan checkin <kr-id> <value> --note \"<where it stands>\".",
    });
  }
  if (warnings) {
    options.push({
      label: warnings === 1 ? "Look at the plan's one delivery warning" : `Look at the plan's ${warnings} delivery warnings`,
      do: "Run nikos plan status and tell the person which bet links or code repos need attention.",
    });
  }
  if (!krs.length && (area.level === "company" || area.level === "department")) {
    options.unshift({
      label: "Add a key result",
      do: `Ask what the ${area.level === "company" ? "company" : "department"} should change this period, then add the key results with nikos plan kr new <id> --in ${area.rel} --title "<title>" --target <n>.`,
    });
  }
  options.push({ label: "Look at the plan", do: `Run nikos plan status --in ${area.rel}, or open the dashboard with nikos plan serve, and show the person.` });

  const label = area.level === "company" ? file.name ?? "The company" : `${file.name ?? area.id} (${area.rel})`;
  const period = area.level === "company" ? companyYear(repo) : undefined;
  return { summary: `${label}${period ? ` (${period})` : ""}: ${count(krs.length, "key result")}, ${count(bets.length, "bet")}`, options: options.slice(0, MAX) };
}
