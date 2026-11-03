import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import type { LintIssue } from "./gherkin.js";

/** The only frontmatter keys every harness (Claude Code, Cursor, Codex) understands. */
const ALLOWED_KEYS = ["name", "description"];

/** Tool names that exist in one harness only. A portable skill describes the action instead. */
const HARNESS_TOOLS = [
  "TodoWrite", "TodoRead", "TaskCreate", "TaskUpdate", "TaskList", "AskUserQuestion",
  "EnterPlanMode", "ExitPlanMode", "NotebookEdit", "SlashCommand", "todo_write", "update_plan",
  "apply_patch", "$ARGUMENTS", "allowed-tools",
];

export interface SkillIssue extends LintIssue {
  file: string;
}

/** Lint one SKILL.md (or a file it links to) for harness-specific features. */
export function lintSkill(text: string, { isEntry = true } = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  let body = text;
  if (isEntry) {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!m) {
      issues.push({ level: "error", message: "has no frontmatter", hint: "start with ---, name: and description:, then ---" });
    } else {
      body = text.slice(m[0].length);
      let meta: Record<string, unknown> = {};
      try {
        meta = parse(m[1]) ?? {};
      } catch (err) {
        issues.push({ level: "error", message: `frontmatter isn't valid YAML: ${(err as Error).message.split("\n")[0]}` });
      }
      for (const key of Object.keys(meta)) {
        if (!ALLOWED_KEYS.includes(key)) {
          issues.push({ level: "error", message: `frontmatter key '${key}' isn't portable`, hint: "use only name and description" });
        }
      }
      for (const key of ALLOWED_KEYS) {
        if (typeof meta[key] !== "string" || !(meta[key] as string).trim()) {
          issues.push({ level: "error", message: `frontmatter is missing '${key}'` });
        }
      }
    }
  }
  for (const tool of HARNESS_TOOLS) {
    if (body.includes(tool)) {
      issues.push({ level: "error", message: `names the harness-only tool '${tool}'`, hint: "describe the action (\"your task list\") instead" });
    }
  }
  return issues;
}

/** Lint every Markdown file under a skills/ folder. SKILL.md files are entry points and need frontmatter. */
export function lintSkills(dir: string): SkillIssue[] {
  const issues: SkillIssue[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".md")) {
        const file = relative(dir, path);
        for (const i of lintSkill(readFileSync(path, "utf8"), { isEntry: name === "SKILL.md" })) issues.push({ ...i, file });
      }
    }
  };
  walk(dir);
  return issues;
}
