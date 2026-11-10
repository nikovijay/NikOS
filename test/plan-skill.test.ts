import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { lintSkill } from "../src/lint/portable";

// The nikos-plan skill: the company's plan in its planning repo. It ships in the root plugin, next
// to nikos-spec, so there is no pack to install and no second manifest to keep.

const root = join(__dirname, "..");
const skill = join(root, "skills/nikos-plan");
const playbook = (name: string) => readFileSync(join(skill, "playbooks", `${name}.md`), "utf8");
const steps = (text: string) => [...text.matchAll(/^(\d+)\. (.+)$/gm)].map(([, n, s]) => ({ n: Number(n), s }));

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}

describe("nikos-plan skill", () => {
  it("ships in the root skills folder, with no pack of its own", () => {
    expect(existsSync(join(root, "tools", "planning"))).toBe(false);
    expect(existsSync(join(skill, "SKILL.md"))).toBe(true);
  });

  it("ships a portable skill whose playbooks all exist", () => {
    const text = readFileSync(join(skill, "SKILL.md"), "utf8");
    const meta = parse(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "") as { name?: string };
    expect(meta.name).toBe("nikos-plan");
    expect(lintSkill(text)).toEqual([]);
    for (const f of files(skill).filter((f) => f.endsWith(".md") && !f.endsWith("SKILL.md"))) expect(lintSkill(readFileSync(f, "utf8"), { isEntry: false }), relative(root, f)).toEqual([]);
    for (const [, file] of text.matchAll(/`(playbooks\/[\w-]+\.md)`/g)) expect(existsSync(join(skill, file)), file).toBe(true);
    expect(existsSync(join(skill, "principles.md"))).toBe(true);
  });

  it("the skill keeps the rule about company goals", () => {
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toContain("Never put company goals in `constitution.md`");
  });

  it("check-in playbook confirms before writing", () => {
    const s = steps(playbook("checkin"));
    const ask = s.find((x) => /current value, an optional evidence link and a short note/.test(x.s))!;
    const show = s.find((x) => /^Show the check-ins you will add, once/.test(x.s))!;
    const write = s.find((x) => /^Write only after the person confirms: `nikos plan checkin/.test(x.s))!;
    expect(s[0].s).toMatch(/list the key results/);
    expect(ask.n).toBeLessThan(show.n);
    expect(show.n).toBeLessThan(write.n);
  });

  it("wizard asks period, area and pillars", () => {
    const s = steps(playbook("wizard"));
    expect(s[0].s).toMatch(/^Establish context\. Ask for the period/);
    expect(s[0].s).toContain("pillars");
    expect(s[0].s).toContain("Key results stop at department level");
  });

  it("wizard writes only after approval", () => {
    const text = playbook("wizard");
    const s = steps(text);
    const show = s.find((x) => /^Show the whole draft/.test(x.s))!;
    const write = s.find((x) => /^Once they approve, write it/.test(x.s))!;
    expect(show.s).toContain("Write nothing until they approve it");
    expect(show.n).toBeLessThan(write.n);
    expect(s.filter((x) => x.n < write.n).every((x) => !/nikos plan (kr|bet) new/.test(x.s.replace("follow the steps of `bet.md` up to writing it", "")))).toBe(true);
  });

  it("the review playbook records decisions through the command", () => {
    const text = playbook("review");
    expect(text).toContain("nikos plan bet review <bet-id> <continue|change|stop|complete> --why");
    expect(text).toMatch(/won or lost/);
  });

  it("setup makes the planning repo with nikos plan init", () => {
    expect(playbook("setup")).toContain("nikos plan init --name");
  });

  it("holds no credentials, private paths or account-specific settings", () => {
    const leaks = [/\/Users\/|\/home\/[a-z]/, /\/tmp\//, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /(api[_-]?key|secret|password|token)\s*[:=]\s*["']?[\w-]{8,}/i, /intentdocs|productbuilders|grok/i];
    for (const path of files(skill)) {
      const text = readFileSync(path, "utf8");
      for (const leak of leaks) expect(text, `${relative(root, path)} matches ${leak}`).not.toMatch(leak);
    }
  });
});
