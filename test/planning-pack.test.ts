import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { lintSkill } from "../src/lint/portable";

// The Planning pack (tools/planning/): its own plugin, listed next to nikOS, with the
// router's planning playbook handing requests to its skill.

const root = join(__dirname, "..");
const pack = join(root, "tools/planning");
const skill = join(pack, "skills/nikos-planning");
const json = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const pkg = json("package.json");
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

describe("Planning pack", () => {
  it.each([".claude-plugin", ".cursor-plugin", ".codex-plugin"])("manifests name the pack and version (%s)", (dir) => {
    const m = json(`tools/planning/${dir}/plugin.json`);
    expect(m.name).toBe("nikos-planning");
    expect(m.version).toBe(pkg.version);
    expect(existsSync(join(pack, m.skills))).toBe(true);
  });

  it("both marketplaces list it", () => {
    expect(json(".claude-plugin/marketplace.json").plugins).toContainEqual(expect.objectContaining({ name: "nikos-planning", source: "./tools/planning" }));
    expect(json(".agents/plugins/marketplace.json").plugins).toContainEqual(
      expect.objectContaining({ name: "nikos-planning", source: { source: "local", path: "./tools/planning" } }),
    );
  });

  it("install docs show the command", () => {
    const install = readFileSync(join(root, "docs/install.md"), "utf8");
    expect(install).toMatch(/^\| Planning \| `tools\/planning\/` \| `\/plugin install nikos-planning@nikos` \|$/m);
    expect(readFileSync(join(pack, "README.md"), "utf8")).toContain("/plugin install nikos-planning@nikos");
  });

  it("ships a portable skill whose playbooks all exist", () => {
    const text = readFileSync(join(skill, "SKILL.md"), "utf8");
    const meta = parse(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "") as { name?: string };
    expect(meta.name).toBe("nikos-planning");
    expect(lintSkill(text)).toEqual([]);
    for (const f of files(skill).filter((f) => f.endsWith(".md") && !f.endsWith("SKILL.md"))) expect(lintSkill(readFileSync(f, "utf8"), { isEntry: false }), relative(root, f)).toEqual([]);
    for (const [, file] of text.matchAll(/`(playbooks\/[\w-]+\.md)`/g)) expect(existsSync(join(skill, file)), file).toBe(true);
    expect(existsSync(join(skill, "principles.md"))).toBe(true);
  });

  it("the router hands planning requests to the pack", () => {
    const index = readFileSync(join(root, "skills/nikos-mode/playbooks/index.md"), "utf8");
    const row = [...index.matchAll(/^\| ([\w-]+) \| `([^`]+)` \| (.+) \|$/gm)].find(([, name]) => name === "planning");
    expect(row?.[2]).toBe("planning.md");
    const text = readFileSync(join(root, "skills/nikos-mode/playbooks/planning.md"), "utf8");
    expect(text).toMatch(/^1\. Check the Planning pack is installed/m);
    expect(text).toContain("/plugin install nikos-planning@nikos");
  });

  it("check-in playbook confirms before writing", () => {
    const s = steps(playbook("checkin"));
    const ask = s.find((x) => /current value, an optional evidence link and a short note/.test(x.s))!;
    const show = s.find((x) => /^Show the check-ins you will add, once/.test(x.s))!;
    const write = s.find((x) => /^Write only after the person confirms: `nikos planning checkin/.test(x.s))!;
    expect(s[0].s).toMatch(/list the person's key results/);
    expect(ask.n).toBeLessThan(show.n);
    expect(show.n).toBeLessThan(write.n);
  });

  it("wizard asks period, level and pillars", () => {
    expect(steps(playbook("wizard"))[0].s).toMatch(/^Establish context\. Ask for the planning period .*, the level \(company, department or group\) and the strategic pillars/);
    expect(steps(playbook("wizard"))[0].s).toContain("OKRs stop at department level");
  });

  it("wizard continues without a parent and writes only after approval", () => {
    const text = playbook("wizard");
    const s = steps(text);
    expect(text).toContain("parent alignment is optional, never an entry requirement");
    expect(text).toMatch(/If they aren't, continue independently/);
    const show = s.find((x) => /^Show the whole draft/.test(x.s))!;
    const write = s.find((x) => /^Once they approve, write it/.test(x.s))!;
    expect(show.s).toContain("Write nothing until they approve it");
    expect(show.n).toBeLessThan(write.n);
    expect(s.filter((x) => x.n < write.n).every((x) => !/nikos planning (kr|bet) new/.test(x.s.replace("follow the steps of `bet.md` up to writing it", "")))).toBe(true);
  });

  it("the review playbook records decisions through the command", () => {
    const text = playbook("review");
    expect(text).toContain("nikos planning bet review <bet-id> <decision> --why");
    expect(text).toMatch(/won or lost/);
  });

  it("holds no credentials, private paths or account-specific settings", () => {
    const leaks = [/\/Users\/|\/home\/[a-z]/, /\/tmp\//, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /(api[_-]?key|secret|password|token)\s*[:=]\s*["']?[\w-]{8,}/i, /intentdocs|productbuilders|grok/i];
    for (const path of files(pack)) {
      const text = readFileSync(path, "utf8");
      for (const leak of leaks) expect(text, `${relative(root, path)} matches ${leak}`).not.toMatch(leak);
    }
  });
});
