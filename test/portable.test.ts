import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lintSkill, lintSkills } from "../src/lint/portable";

const skillsDir = join(__dirname, "../skills");
const router = join(skillsDir, "nikos-spec");
const ok = "---\nname: demo\ndescription: A demo skill.\n---\n\n# demo\n";

describe("portable skills", () => {
  it("no harness-specific frontmatter", () => {
    expect(lintSkills(skillsDir)).toEqual([]);
  });

  it("accepts plain name and description", () => {
    expect(lintSkill(ok)).toEqual([]);
  });

  it("rejects extra frontmatter keys", () => {
    const issues = lintSkill(ok.replace("description:", "allowed-tools: Bash\ndescription:"));
    expect(issues.map((i) => i.message)).toContain("frontmatter key 'allowed-tools' isn't portable");
  });

  it("rejects missing frontmatter", () => {
    expect(lintSkill("# demo\n")[0].message).toBe("has no frontmatter");
    expect(lintSkill("---\nname: demo\n---\n").map((i) => i.message)).toContain("frontmatter is missing 'description'");
  });

  it("rejects harness-only tool names in the body", () => {
    expect(lintSkill(ok + "Use TodoWrite to track steps.\n").map((i) => i.message)).toEqual([
      "names the harness-only tool 'TodoWrite'",
    ]);
    expect(lintSkill("Call update_plan.\n", { isEntry: false })).toHaveLength(1);
  });
});

describe("nikos-spec router", () => {
  const skill = readFileSync(join(router, "SKILL.md"), "utf8");
  const index = readFileSync(join(router, "playbooks/index.md"), "utf8");
  const rows = [...index.matchAll(/^\| (\w[\w-]*) \| `([^`]+)` \|/gm)];

  it("reads the principles index and names the chosen playbook", () => {
    expect(skill).toContain("principles/index.md");
    expect(skill).toContain("playbooks/index.md");
    expect(skill).toMatch(/Playbook: \*\*<name>\*\*/);
  });

  it("copies every step and keeps skipped steps with a reason", () => {
    expect(skill).toMatch(/Copy each numbered step into your task list,\s+word for word/);
    expect(skill).toMatch(/Markdown checklist/);
    expect(skill).toMatch(/marked skipped, with the reason/);
    expect(skill).toMatch(/lists every step with its outcome/);
  });

  it("indexes only playbooks that exist, each with numbered steps", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const [, name, file] of rows) {
      const path = join(router, "playbooks", file);
      expect(existsSync(path), `${name} → ${file}`).toBe(true);
      expect(readFileSync(path, "utf8")).toMatch(/^1\. /m);
    }
  });

  it("lists every principle with a trigger", () => {
    const principles = readFileSync(join(router, "principles/index.md"), "utf8");
    const lines = principles.split("\n").filter((l) => l.startsWith("| **"));
    expect(lines).toHaveLength(5); // the two bet principles moved to the Planning pack
    for (const l of lines) expect(l.split("|").map((c) => c.trim()).filter(Boolean)).toHaveLength(2);
  });
});
