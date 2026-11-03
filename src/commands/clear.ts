import { join } from "node:path";
import { featureStoryIds, findIntentDir, read, rel, walk } from "../lib/project.js";
import { parseFeature, scenariosOf } from "../lint/gherkin.js";

export type CheckName = "Clear" | "Lean" | "Executable" | "Accurate" | "Responsible";

export interface CheckResult {
  check: CheckName;
  /** `agent` means the check needs judgement, so the CLEAR skill decides it. */
  status: "pass" | "fail" | "agent";
  message: string;
  fix?: string;
}

const CHECKS: CheckName[] = ["Clear", "Lean", "Executable", "Accurate", "Responsible"];

/** Implementation detail that doesn't belong in a spec. Case-sensitive names avoid ordinary English words. */
const LEAN_RULES: { what: string; re: RegExp }[] = [
  { what: "a file path", re: /\b[\w-]+(?:\/[\w.-]+)*\.(?:ts|tsx|js|jsx|py|rb|go|java|kt|swift|sql|json|ya?ml|css|html)\b/ },
  { what: "SQL", re: /\b(?:SELECT\s+[\w*, ]+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i },
  {
    what: "a framework or storage name",
    re: /\b(?:React|Vue|Angular|Svelte|Next\.js|Django|Flask|Laravel|PostgreSQL|Postgres|MySQL|MongoDB|Redis|SQLite|localStorage|sessionStorage|IndexedDB|GraphQL|Kafka|DynamoDB|Firebase|Supabase|Docker|Kubernetes)\b/,
  },
];

const JUDGED: Record<"Clear" | "Accurate" | "Responsible", string> = {
  Clear: "needs a reader: one reading, no ambiguity",
  Accurate: "needs a reader: matches constitution.md and decisions.md",
  Responsible: "needs a reader: privacy, safety and accessibility considered",
};

/** Run CLEAR's mechanical checks (Lean, Executable) on a feature file and report all five checks. */
export function clear(text: string): CheckResult[] {
  const results = new Map<CheckName, CheckResult>();
  for (const check of ["Clear", "Accurate", "Responsible"] as const) {
    results.set(check, { check, status: "agent", message: JUDGED[check] });
  }

  let feature;
  try {
    feature = parseFeature(text);
  } catch (err) {
    feature = undefined;
    results.set("Executable", {
      check: "Executable",
      status: "fail",
      message: `isn't valid Gherkin: ${(err as Error).message.split("\n")[0]}`,
      fix: "Fix the Gherkin syntax so the feature can run",
    });
  }

  if (feature) {
    const scenarios = scenariosOf(feature);
    // Given is optional (docs/gherkin.md); When and Then are what make a scenario runnable.
    const incomplete = scenarios.filter((s) => {
      const keywords = new Set(s.steps.map((st) => st.keyword.trim()));
      return !keywords.has("When") || !keywords.has("Then");
    });
    if (scenarios.length === 0) {
      results.set("Executable", { check: "Executable", status: "fail", message: "has no scenarios", fix: "Add at least one Scenario for each acceptance criterion" });
    } else if (incomplete.length) {
      results.set("Executable", {
        check: "Executable",
        status: "fail",
        message: `${incomplete.map((s) => `"${s.name}"`).join(", ")} ${incomplete.length === 1 ? "is" : "are"} missing a When or Then step`,
        fix: "Give every Scenario a When (the action) and a Then (the outcome)",
      });
    } else {
      results.set("Executable", { check: "Executable", status: "pass", message: `${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"}, each with When and Then` });
    }

    // Only the prose: names, descriptions and steps. Tags are metadata.
    const prose = [feature.name, feature.description, ...scenarios.flatMap((s) => [s.name, s.description, ...s.steps.map((st) => st.text)])].join("\n");
    const found = LEAN_RULES.flatMap(({ what, re }) => {
      const m = re.exec(prose);
      return m ? [`${what} ("${m[0]}")`] : [];
    });
    results.set(
      "Lean",
      found.length
        ? { check: "Lean", status: "fail", message: `names ${found.join(", ")}`, fix: "Describe what the user sees and does; move implementation detail to the plan" }
        : { check: "Lean", status: "pass", message: "no implementation detail found" },
    );
  } else {
    results.set("Lean", { check: "Lean", status: "fail", message: "can't be checked until the feature parses", fix: "Fix the Gherkin syntax first" });
  }

  return CHECKS.map((c) => results.get(c)!);
}

export function formatClear(results: CheckResult[]): string {
  const mark = { pass: "✓", fail: "✗", agent: "?" };
  return results.map((r) => `${mark[r.status]} ${r.check.padEnd(11)} ${r.message}${r.fix ? `. Fix: ${r.fix}` : ""}`).join("\n");
}

/** Find the feature file that carries a story id. */
export function featureFor(story: string, dir: string): string | undefined {
  return walk(join(findIntentDir(dir), "features"), ".feature").find((f) => featureStoryIds(read(f)).includes(story));
}

export function runClear(args: string[]): number {
  const [story, ...rest] = args;
  if (!story) {
    console.error("Usage: nikos clear <story-id> [--dir <path>]");
    return 1;
  }
  const i = rest.indexOf("--dir");
  const dir = i >= 0 ? rest[i + 1] : process.cwd();
  const file = featureFor(story, dir);
  if (!file) {
    console.error(`✗ No feature file is tagged @${story}`);
    return 1;
  }
  const results = clear(read(file));
  console.log(`CLEAR ${story} (${rel(process.cwd(), file)})\n${formatClear(results)}`);
  if (results.some((r) => r.status === "agent")) console.log("\n? = judged by the agent with the clear skill");
  return results.some((r) => r.status === "fail") ? 1 : 0;
}
