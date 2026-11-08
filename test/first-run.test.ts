import { describe, it, expect } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askOnboarding, currentQuarter, setUp, type Ask } from "../src/commands/onboard";
import { start } from "../src/commands/start";
import { parse } from "yaml";
import { runServeCommand } from "../src/commands/serve";
import { nodeWarning } from "../src/commands/verify";
import { cliCommand, compareVersions, ownVersion, staleCliWarning } from "../src/lib/cli-version";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Answers in order; records each question and its suggestion. */
const scripted = (answers: string[]) => {
  const asked: { q: string; s?: string }[] = [];
  const ask: Ask = async (q, s) => {
    asked.push({ q, s });
    return answers.shift() ?? "";
  };
  return { ask, asked };
};

describe("the onboarding wizard", () => {
  it("won't set up in the home folder, and asks the key apart from the name", async () => {
    const home = mkdtempSync(join(tmpdir(), "nikos-home-"));
    const { ask, asked } = scripted(["6", "Acme Robotics", "", "", "", ""]);
    const a = await askOnboarding(home, ask, home);
    expect(a).toEqual({ kind: "both", dir: join(home, "acme-robotics"), name: "Acme Robotics", key: "AR", period: currentQuarter(), gitInit: true });
    expect(asked.map((x) => x.q.split("\n")[0])).toEqual([
      "What are you setting up?",
      "Company or department name",
      "Your home folder isn't a good place for a repo. Folder to create for it",
      "Story key: every story id starts with it (AR-1), and it's hard to change later",
      "Planning period",
      "Make it a git repo? (Y/n)",
    ]);
    // No folder name to fall back on at home.
    expect(asked[1].s).toBeUndefined();

    const lines = setUp(a, home);
    expect(existsSync(join(a.dir, ".git"))).toBe(true);
    expect(existsSync(join(a.dir, "intent/storymap.yaml"))).toBe(true);
    expect(readFileSync(join(a.dir, "planning/plan.yaml"), "utf8")).toContain("level: company");
    expect(readFileSync(join(a.dir, "intent/storymap.yaml"), "utf8")).toContain("AR");
    // With the version check off, no current nikos is known on PATH, so it names npx.
    expect(lines).toContain("See it: cd acme-robotics && npx -y nikos@latest serve");
  });

  it("asks again on an answer it can't use, and sets a company plan up in this folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-co-"));
    const { ask, asked } = scripted(["x", "1", "Acme", "Q1 2027", "y", "Payments, Growth", "n"]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    expect(asked[1].q).toMatch(/^Please choose 1 to 6\. What are you setting up\?/);
    expect(a).toEqual({ kind: "company", dir, name: "Acme", period: "Q1 2027", departments: ["Payments", "Growth"], gitInit: false });
    const lines = setUp(a, dir);
    expect(existsSync(join(dir, "intent"))).toBe(false);
    expect(readFileSync(join(dir, "planning/downstream.yaml"), "utf8")).toContain("Payments");
    expect(lines.at(-2)).toBe("See it: npx -y nikos@latest serve");
  });

  it("checks before setting up on top of another project, and rejects a bad key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-busy-"));
    writeFileSync(join(dir, "notes.txt"), "mine\n");
    const { ask, asked } = scripted(["5", "Tip Calc", "", "", "9X", "tc", "n"]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    expect(asked[2].q).toContain("This folder already has files in it");
    expect(a).toMatchObject({ kind: "product", dir: join(dir, "tip-calc"), key: "TC" });
    expect(asked[5].q).toMatch(/^Letters and digits/);
  });

  it("asks a group's key, and makes its own team with the smallest setup when it is its own team", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-group-wiz-"));
    const { ask, asked } = scripted(["3", "Checkout Group", "PAY", "Q1 2027", "y", "n"]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    expect(asked.map((x) => x.q.split("\n")[0])).toContain("The group's key is the prefix of every story id in its maps (PAY-HT-1). Letters and numbers, starting with a letter.");
    expect(a).toEqual({ kind: "group", dir, name: "Checkout Group", key: "PAY", period: "Q1 2027", sameTeam: true, gitInit: false });
    const lines = setUp(a, dir);
    const plan = parse(readFileSync(join(dir, "planning/plan.yaml"), "utf8"));
    expect(plan).toMatchObject({ level: "group", key: "PAY", period: "Q1 2027" });
    expect(lines.join("\n")).toContain('assign "Checkout Group" --repo .');
    expect(lines.join("\n")).toContain("planning bet new <bet-id>");
    expect(existsSync(join(dir, "intent"))).toBe(false);
    expect(existsSync(join(dir, "nikos.team.yaml"))).toBe(false);
  });

  it("a group that isn't its own team says teams join it later, and makes no team file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-group-nt-"));
    const { ask } = scripted(["3", "Checkout Group", "PAY", "Q1 2027", "n", "n"]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    expect(a).toMatchObject({ kind: "group", sameTeam: false });
    const lines = setUp(a, dir);
    expect(lines.join("\n")).toContain("Teams join later with nikos team init in each team repo, then nikos team join.");
    expect(existsSync(join(dir, "nikos.team.yaml"))).toBe(false);
  });

  it("a team repo is refused before any question when its folder has intent/, and joins with teamInit otherwise", async () => {
    const busy = mkdtempSync(join(tmpdir(), "nikos-team-busy-"));
    mkdirSync(join(busy, "intent"));
    const refused = scripted(["4"]);
    await expect(askOnboarding(busy, refused.ask, "/nowhere")).rejects.toThrow("this repo has its own story map (intent/ or maps/), and a team repo can't hold one. Move it to a group repo with nikos migrate maps, or pick another option");
    expect(refused.asked.length).toBe(1);

    const dir = mkdtempSync(join(tmpdir(), "nikos-team-wiz-"));
    const { ask } = scripted(["4", "Checkout Web", "", "n"]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    expect(a).toMatchObject({ kind: "team", name: "Checkout Web" });
    setUp(a, dir);
    expect(existsSync(join(dir, "nikos.team.yaml"))).toBe(true);
    expect(existsSync(join(dir, "intent"))).toBe(false);
  });

  it("a product keeps its own path: the same start, and a See it line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-product-wiz-"));
    const { ask } = scripted(["5", "Tip Calc", "TC", "n"]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    const lines = setUp(a, dir);
    expect(existsSync(join(dir, "intent/storymap.yaml"))).toBe(true);
    expect(lines.some((l) => l.startsWith("See it: "))).toBe(true);
    expect(lines.join("\n")).toContain("nikos migrate maps moves an intent/ story map into one.");
  });

  it("start refuses a repo that has maps/", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-start-maps-"));
    mkdirSync(join(dir, "maps"));
    expect(() => start(dir)).toThrow("This repo has maps/ (group story maps). Add a product's story map with nikos map new, not start.");
  });

  it("is only for a person at a terminal: start with flags never asks", () => {
    const start = read("src/commands/start.ts");
    expect(start).toContain('!flag("name") && !flag("key") && !args.includes("--yes") && interactive()');
    expect(start).toMatch(/process\.stdin\.isTTY && !!process\.stdout\.isTTY && !process\.env\.CI/);
  });
});

describe("nikos serve", () => {
  it("says how to set up when there's nothing to show", async () => {
    expect(await runServeCommand(["--dir", mkdtempSync(join(tmpdir(), "nikos-empty-"))])).toBe(1);
  });
});

describe("verify setup's Node check", () => {
  it("names the Node versions Cucumber 12 runs on", () => {
    expect(nodeWarning("js", "v23.3.0")).toMatch(/^Cucumber 12 runs on Node 20, 22, or 24 and later, and this is Node 23\.3\.0\./);
    expect(nodeWarning("ts", "v18.20.0")).toContain("nvm install 22");
    for (const v of ["v20.11.0", "v22.23.4", "v24.1.0", "v26.0.0"]) expect(nodeWarning("js", v)).toBeUndefined();
    expect(nodeWarning("python", "v23.3.0")).toBeUndefined();
  });
});

describe("an old nikos on the PATH", () => {
  const withPath = (script: string | undefined, fn: () => void) => {
    const bin = mkdtempSync(join(tmpdir(), "nikos-bin-"));
    if (script) {
      writeFileSync(join(bin, "nikos"), `#!/bin/sh\n${script}\n`);
      chmodSync(join(bin, "nikos"), 0o755);
    }
    const saved = { PATH: process.env.PATH, check: process.env.NIKOS_NO_VERSION_CHECK };
    process.env.PATH = bin;
    delete process.env.NIKOS_NO_VERSION_CHECK;
    try {
      fn();
    } finally {
      process.env.PATH = saved.PATH;
      if (saved.check) process.env.NIKOS_NO_VERSION_CHECK = saved.check;
    }
  };

  it("is reported with how to update it, and a current one isn't", () => {
    expect(compareVersions("0.2.3", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
    withPath('echo "Unknown command \'--version\'." >&2; exit 1', () => expect(staleCliWarning()).toMatch(/^The nikos command on your PATH is an old version \(before 0\.2\), older than \d/));
    withPath('echo "0.1.0"', () => expect(staleCliWarning()).toContain("is 0.1.0, older than"));
    withPath(`echo "${ownVersion()}"`, () => {
      expect(staleCliWarning()).toBeUndefined();
      expect(cliCommand()).toBe("nikos");
    });
    withPath(undefined, () => expect(staleCliWarning()).toBeUndefined());
  });
});

describe("the skills on a first run", () => {
  it("route setup in any folder to the onboard playbook, and run nikos@latest", () => {
    const skill = read("skills/nikos-mode/SKILL.md");
    expect(skill).toMatch(/description: Entry point for nikOS\. Use when someone has just installed nikOS or asks to set it up/);
    expect(skill).toContain("npx -y nikos@latest --version");
    const index = read("skills/nikos-mode/playbooks/index.md");
    // Second, after a new product idea, and before every playbook for a repo that's already set up.
    expect([...index.matchAll(/^\| ([\w-]+) \| `/gm)].map((m) => m[1]).slice(0, 3)).toEqual(["idea-to-blueprint", "onboard", "company"]);
    const onboard = read("skills/nikos-mode/playbooks/onboard.md");
    expect(onboard).toContain("Never set nikOS up in the home folder");
    expect(onboard).toContain("Never take one word as both the name and the key without asking");
    expect(onboard).toContain("nikos serve");
    expect(read("tools/planning/skills/nikos-planning/SKILL.md")).toContain("Never put company goals in `intent/constitution.md`");
    expect(read("hooks/cursor-session-start.mjs")).toContain('["npx", ["-y", "nikos@latest"]]');
  });
});
