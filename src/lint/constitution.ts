import { parse } from "yaml";
import type { LintIssue } from "./gherkin.js";

/** The five vision sections every constitution has, in this order (docs/format.md). */
export const VISION_SECTIONS = ["Users", "Problem", "Switch", "First", "Proof"];

/** Check constitution.md has its front matter and the five vision sections, in order and filled in. */
export function lintConstitution(text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  let body = text;
  if (!m) {
    issues.push({ level: "error", message: "has no front matter", hint: "start with ---, name: and idea:, then ---" });
  } else {
    body = text.slice(m[0].length);
    let meta: Record<string, unknown> = {};
    try {
      meta = parse(m[1]) ?? {};
    } catch (err) {
      issues.push({ level: "error", message: `front matter isn't valid YAML: ${(err as Error).message.split("\n")[0]}` });
    }
    for (const key of ["name", "idea"]) {
      if (typeof meta[key] !== "string" || !(meta[key] as string).trim()) issues.push({ level: "error", message: `front matter is missing '${key}'` });
    }
  }

  // Split into "## Heading" sections; anything before the first heading is ignored.
  const sections = [...body.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map((s) => ({ title: s[1].trim(), text: s[2].trim() }));
  const titles = sections.map((s) => s.title);
  const missing = VISION_SECTIONS.filter((t) => !titles.includes(t));
  if (missing.length) {
    issues.push({ level: "error", message: `is missing ${missing.map((t) => `## ${t}`).join(", ")}`, hint: `the five vision sections are ${VISION_SECTIONS.join(", ")}` });
  } else if (VISION_SECTIONS.some((t, i) => titles[i] !== t)) {
    issues.push({ level: "error", message: `vision sections are out of order (${titles.slice(0, 5).join(", ")})`, hint: `put ${VISION_SECTIONS.join(", ")} first, in that order; extra sections go after` });
  }
  for (const s of sections.filter((s) => VISION_SECTIONS.includes(s.title) && !s.text)) {
    issues.push({ level: "error", message: `## ${s.title} is empty` });
  }
  return issues;
}
