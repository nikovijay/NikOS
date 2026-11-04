import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { lintSkill } from "../src/lint/portable";

// The Video pack (tools/video/): its own plugin, listed next to nikOS, with the
// router's video playbook handing requests to its skill.

const root = join(__dirname, "..");
const pack = join(root, "tools/video");
const skill = join(pack, "skills/product-tour-video");
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

describe("Video pack", () => {
  it.each([".claude-plugin", ".cursor-plugin", ".codex-plugin"])("%s manifest names the pack and nikOS's version", (dir) => {
    const m = json(`tools/video/${dir}/plugin.json`);
    expect(m.name).toBe("nikos-video");
    expect(m.version).toBe(pkg.version);
    expect(existsSync(join(pack, m.skills))).toBe(true);
  });

  it("both marketplaces list it from its own folder", () => {
    expect(json(".claude-plugin/marketplace.json").plugins).toContainEqual(expect.objectContaining({ name: "nikos-video", source: "./tools/video" }));
    expect(json(".agents/plugins/marketplace.json").plugins).toContainEqual(
      expect.objectContaining({ name: "nikos-video", source: { source: "local", path: "./tools/video" } }),
    );
  });

  it("ships the video skill with its engine, scripts and references", () => {
    const text = readFileSync(join(skill, "SKILL.md"), "utf8");
    const meta = parse(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "") as { name?: string };
    expect(meta.name).toBe("product-tour-video");
    expect(lintSkill(text)).toEqual([]);
    for (const f of ["assets/starter/tour.html", "scripts/render.mjs", "scripts/music.mjs", "scripts/mix.mjs", "scripts/contact.mjs"]) {
      expect(existsSync(join(skill, f)), f).toBe(true);
    }
    // Every reference the skill names is in the pack.
    for (const [, ref] of text.matchAll(/`(references\/[\w-]+\.md)`/g)) expect(existsSync(join(skill, ref)), ref).toBe(true);
  });

  it("the router sends a request for a video to the video playbook, which hands over to the pack", () => {
    const index = readFileSync(join(root, "skills/nikos-mode/playbooks/index.md"), "utf8");
    const rows = [...index.matchAll(/^\| ([\w-]+) \| `([^`]+)` \| (.+) \|$/gm)].map(([, name, file, when]) => ({ name, file, when }));
    const first = rows.find((r) => /\bvideo\b/i.test(r.when));
    expect(first).toMatchObject({ name: "video", file: "video.md" });
    const playbook = readFileSync(join(root, "skills/nikos-mode/playbooks", first!.file), "utf8");
    expect(playbook).toMatch(/^1\. Check the Video pack is installed/m);
    expect(playbook).toContain("`product-tour-video`");
    expect(playbook).toContain("/plugin install nikos-video@nikos");
  });

  it("holds no credentials, private paths or account-specific settings", () => {
    const leaks = [
      /\/Users\/|\/home\/[a-z]|[A-Z]:\\\\Users/, // home folders
      /\/tmp\//, // machine-specific scratch paths
      /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, // email addresses
      /\b(sk|pk|rk)_(live|test)_|\bsk-[A-Za-z0-9]{20}|gh[pousr]_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|xox[baprs]-/, // API keys and tokens
      /(api[_-]?key|secret|password|token)\s*[:=]\s*["']?[\w-]{8,}/i, // assigned secrets
      /intentdocs|productbuilders|higgsfield|courtside|grok bot|mcp apps|feature-tour|\bINT-\d/i, // the private projects it came from
    ];
    for (const path of files(pack)) {
      const text = readFileSync(path, "utf8");
      for (const leak of leaks) expect(text, `${relative(root, path)} matches ${leak}`).not.toMatch(leak);
    }
  });
});
