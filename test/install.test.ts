import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

// One skills/ tree, one manifest per tool (docs/install.md). These checks keep
// the manifests agreeing with each other and with the skills they ship.

const root = join(__dirname, "..");
const json = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const pkg = json("package.json");

const manifests = {
  "Claude Code": ".claude-plugin/plugin.json",
  Cursor: ".cursor-plugin/plugin.json",
  Codex: ".codex-plugin/plugin.json",
};

const skillDirs = readdirSync(join(root, "skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

/** Every SKILL.md under the repo, outside node_modules, test output and .claude (local worktrees and their copies). */
function allSkillFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", ".evals-out", ".claude"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) allSkillFiles(path, out);
    else if (entry.name === "SKILL.md") out.push(path);
  }
  return out;
}

describe("install manifests", () => {
  it.each(Object.entries(manifests))("%s's manifest names the package and its version", (_tool, path) => {
    const m = json(path);
    expect(m.name).toBe(pkg.name);
    expect(m.version).toBe(pkg.version);
    expect(m.description).toBeTruthy();
    if (m.skills) expect(existsSync(join(root, m.skills))).toBe(true);
  });

  it("listings show nikOS and the install id stays nikos", () => {
    expect(json(".cursor-plugin/plugin.json").displayName).toBe("nikOS");
    expect(json(".claude-plugin/plugin.json").displayName).toBe("nikOS");
    expect(json(".codex-plugin/plugin.json").interface.displayName).toBe("nikOS");
    expect(json(".claude-plugin/marketplace.json").plugins[0]).toEqual(
      expect.objectContaining({ name: "nikos", displayName: "nikOS" }),
    );
    for (const path of Object.values(manifests)) expect(json(path).name).toBe("nikos");
  });

  it("each marketplace lists the plugin at the repo root first", () => {
    const claude = json(".claude-plugin/marketplace.json");
    expect(claude.plugins[0]).toEqual(expect.objectContaining({ name: pkg.name, source: "./" }));
    const codex = json(".agents/plugins/marketplace.json");
    expect(codex.plugins[0]).toEqual(
      expect.objectContaining({ name: pkg.name, source: { source: "local", path: "./" }, policy: expect.objectContaining({ installation: "AVAILABLE" }) }),
    );
  });

  it("ships the one skills folder, with no skill copied anywhere else outside a pack", () => {
    expect(skillDirs).toContain("nikos-mode");
    const skillFiles = allSkillFiles(root)
      .map((p) => p.slice(root.length + 1))
      .filter((p) => !/^tools\/[^/]+\/skills\//.test(p));
    expect(skillFiles.sort()).toEqual(skillDirs.map((d) => `skills/${d}/SKILL.md`).sort());
  });

  it.each(skillDirs)("skills/%s has the front matter every tool reads", (dir) => {
    const text = readFileSync(join(root, "skills", dir, "SKILL.md"), "utf8");
    const meta = parse(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "") as { name?: string; description?: string };
    expect(meta.name).toBe(dir);
    expect(meta.description?.length).toBeGreaterThan(20);
  });

  it("the README and install doc give each tool's command", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const doc = readFileSync(join(root, "docs/install.md"), "utf8");
    for (const text of [readme, doc]) {
      expect(text).toContain("/plugin install nikos --marketplace nikovijay/NikOS");
      expect(text).toContain("codex plugin marketplace add nikovijay/NikOS");
      expect(text).toContain("https://github.com/nikovijay/NikOS");
    }
  });

  it("the Claude Code manifest's icon is a square PNG in the repo", () => {
    const icon = json(".claude-plugin/plugin.json").icon as string;
    const png = readFileSync(join(root, icon));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1024, 1024]);
  });

  it("the npm package carries the manifests' skills", () => {
    expect(pkg.files).toContain("skills");
  });
});
