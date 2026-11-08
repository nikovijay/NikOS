// planning/plan.yaml for a company, a department or a group: its header comment and the file.
// companyInit and migrate maps both write it through planYaml, so the text is the same either way.
import { stringify } from "yaml";

export type PlanLevel = "company" | "department" | "group";

/** Who plans against each level, for its README and join line. */
export const BELOW: Record<PlanLevel, string> = { company: "Departments", department: "Groups", group: "Teams" };

/** The text of planning/plan.yaml for a level. */
export function planYaml(o: { name: string; key?: string; period?: string; level: PlanLevel; pillars?: string[]; below?: string }): string {
  const { name, key, level } = o;
  const holds = level === "group" ? "bets, aimed at the department's key results" : "objectives, key results and bets";
  const below = o.below ?? BELOW[level];
  const note = level === "group" ? " OKRs stop at department level, so it has no key results of its own." : ` ${below} align their ${level === "company" ? "key results and bets" : "bets"} to it.`;
  const period = o.period ?? "Set the period, e.g. Q1 2027";
  return `# ${name}'s plan: its ${holds}.${note}\n${stringify({ name, ...(key ? { key } : {}), period, level, pillars: o.pillars ?? [] })}`;
}
