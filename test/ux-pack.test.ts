import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { lintSkill } from "../src/lint/portable";

// The UX pack (tools/ux/): its own plugin, listed next to nikOS, with the
// router's ux-library playbook handing requests to its skill.

const root = join(__dirname, "..");
const pack = join(root, "tools/ux");
const skill = join(pack, "skills/design-library");
const json = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const pkg = json("package.json");

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}

describe("UX pack", () => {
  it.each([".claude-plugin", ".cursor-plugin", ".codex-plugin"])("%s manifest names the pack and nikOS's version", (dir) => {
    const m = json(`tools/ux/${dir}/plugin.json`);
    expect(m.name).toBe("nikos-ux");
    expect(m.version).toBe(pkg.version);
    expect(existsSync(join(pack, m.skills))).toBe(true);
  });

  it("lists as nikOS UX while the install id stays nikos-ux", () => {
    expect(json("tools/ux/.cursor-plugin/plugin.json").displayName).toBe("nikOS UX");
    expect(json("tools/ux/.claude-plugin/plugin.json").displayName).toBe("nikOS UX");
    expect(json("tools/ux/.codex-plugin/plugin.json").interface.displayName).toBe("nikOS UX");
  });

  it("both marketplaces list it from its own folder, and the install docs give its command", () => {
    expect(json(".claude-plugin/marketplace.json").plugins).toContainEqual(expect.objectContaining({ name: "nikos-ux", source: "./tools/ux" }));
    expect(json(".agents/plugins/marketplace.json").plugins).toContainEqual(
      expect.objectContaining({ name: "nikos-ux", source: { source: "local", path: "./tools/ux" } }),
    );
    expect(readFileSync(join(root, "docs/install.md"), "utf8")).toMatch(/^\| UX \| `tools\/ux\/` \| `\/plugin install nikos-ux@nikos` \|$/m);
    expect(readFileSync(join(pack, "README.md"), "utf8")).toContain("/plugin install nikos-ux@nikos");
  });

  it("ships the design-library skill with every reference it names", () => {
    const text = readFileSync(join(skill, "SKILL.md"), "utf8");
    const meta = parse(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "") as { name?: string };
    expect(meta.name).toBe("design-library");
    expect(lintSkill(text)).toEqual([]);
    const refs = [...text.matchAll(/`(references\/[\w-]+\.md)`/g)].map(([, ref]) => ref);
    expect(refs.length).toBeGreaterThanOrEqual(3);
    for (const ref of refs) {
      expect(existsSync(join(skill, ref)), ref).toBe(true);
      expect(lintSkill(readFileSync(join(skill, ref), "utf8"), { isEntry: false })).toEqual([]);
    }
    // The page and the brief come from one data module, and tests guard it.
    expect(text).toContain("libraryPrompt()");
    expect(text).toMatch(/Render real components/);
    expect(text).toMatch(/Guard it with tests/);
  });

  it("the router sends a request for a component library to the ux-library playbook, which hands over to the pack", () => {
    const index = readFileSync(join(root, "skills/nikos-mode/playbooks/index.md"), "utf8");
    const rows = [...index.matchAll(/^\| ([\w-]+) \| `([^`]+)` \| (.+) \|$/gm)].map(([, name, file, when]) => ({ name, file, when }));
    const first = rows.find((r) => /component library/i.test(r.when));
    expect(first).toMatchObject({ name: "ux-library", file: "ux-library.md" });
    const playbook = readFileSync(join(root, "skills/nikos-mode/playbooks", first!.file), "utf8");
    expect(playbook).toMatch(/^1\. Check the UX pack is installed/m);
    expect(playbook).toContain("`design-library`");
    expect(playbook).toContain("/plugin install nikos-ux@nikos");
  });

  it("holds no credentials, private paths or account-specific settings", () => {
    const leaks = [
      /\/Users\/|\/home\/[a-z]|[A-Z]:\\\\Users/,
      /\/tmp\//,
      /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
      /\b(sk|pk|rk)_(live|test)_|\bsk-[A-Za-z0-9]{20}|gh[pousr]_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|xox[baprs]-/,
      /(api[_-]?key|secret|password|token)\s*[:=]\s*["']?(?!--)[\w-]{8,}/i, // "token" here also names design tokens, which start with --
      /intentdocs|productbuilders|drawn to spec|cyanotype|courtside|\bINT-\d/i, // the private project it came from
    ];
    for (const path of files(pack)) {
      const text = readFileSync(path, "utf8");
      for (const leak of leaks) expect(text, `${relative(root, path)} matches ${leak}`).not.toMatch(leak);
    }
  });
});
