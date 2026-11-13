import { describe, it, expect } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askOnboarding, Cancelled, currentQuarter, setUp, type Ask } from "../src/commands/onboard";
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
  it("won't set up in the home folder, and asks the story key apart from the name", async () => {
    const home = mkdtempSync(join(tmpdir(), "nikos-home-"));
    const { ask, asked } = scripted(["2", "Acme Robotics", "", "", "", "", "", ""]);
    const a = await askOnboarding(home, ask, home);
    expect(a).toEqual({ kind: "spec", dir: join(home, "acme-robotics"), name: "Acme Robotics", key: "AR", gitInit: true });
    expect(asked.map((x) => x.q.split("\n").at(-1))).toEqual([
      "Type 1 or 2",
      "What's the product called?",
      "What should the new folder be called?",
      "Story key: a short code that starts every story id, like AR-1. It's hard to change later.",
      "Is this code part of a company plan? Give its planning repo, like acme/company-plan, or press Enter to skip",
      "Make it a git repo? Git keeps the history of every change. (Y/n)",
      "Type 1, 2 or 3",
      "Go ahead? (Y/n)",
    ]);
    // Where the repo lives: only on this computer unless the person picks GitHub or GitLab.
    expect(asked[6].s).toBe("3");
    expect(asked[2].q).toContain("You're in your home folder");
    // The menu suggests Spec, and no folder name is suggested at home.
    expect(asked[0].s).toBe("2");
    expect(asked[1].s).toBeUndefined();
    // The summary names the full path before anything is written.
    expect(asked[7].q).toContain(`In ${join(home, "acme-robotics")} (a new folder)`);
    expect(asked[7].q).not.toContain("GitHub");
    expect(existsSync(a.dir)).toBe(false);

    const lines = setUp(a, home);
    expect(existsSync(join(a.dir, ".git"))).toBe(true);
    expect(existsSync(join(a.dir, "maps/ar/storymap.yaml"))).toBe(true);
    expect(existsSync(join(a.dir, "planning"))).toBe(false);
    expect(readFileSync(join(a.dir, "maps/ar/storymap.yaml"), "utf8")).toContain("AR");
    // With the version check off, no current nikos is known on PATH, so it names npx.
    expect(lines).toContain("  1. See it in your browser: cd acme-robotics && npx -y nikos@latest serve");
  });

  it("the Plan path asks the year and pillars, and sets up a planning repo with no story map", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-plan-wiz-"));
    // The first answer is not on the menu, so it's asked again; the year must be four digits.
    const { ask, asked } = scripted(["x", "1", "Acme", "Q1 2027", "2027", "Growth, Payments", "n", ""]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    expect(asked[1].q).toMatch(/^'x' isn't one of the choices\. Please type 1 or 2\.\nWhat are you setting up\?/);
    expect(asked[4].q).toMatch(/^Type a four-digit year, like 2027\./);
    expect(asked.map((x) => x.q)).not.toEqual(expect.arrayContaining([expect.stringContaining("Story key")]));
    expect(a).toEqual({ kind: "plan", dir, name: "Acme", year: "2027", pillars: ["Growth", "Payments"], gitInit: false });
    expect(asked.at(-1)!.q).toContain(`In ${dir} (this folder)`);
    expect(asked.at(-1)!.q).toContain("A company plan for Acme, planning 2027, pillars Growth, Payments");

    const lines = setUp(a, dir);
    expect(parse(readFileSync(join(dir, "planning/company/plan.yaml"), "utf8"))).toMatchObject({ name: "Acme", period: "2027", pillars: ["Growth", "Payments"] });
    expect(existsSync(join(dir, "maps"))).toBe(false);
    expect(lines.join("\n")).toContain("Add a department: ");
    expect(lines.join("\n")).toContain('plan add department <id> --name "<name>"');
    expect(lines.join("\n")).toContain("See the plan: ");
  });

  it("the Plan path takes the folder's answer again when it reads like a yes or no", async () => {
    const home = mkdtempSync(join(tmpdir(), "nikos-home-yes-"));
    const { ask, asked } = scripted(["1", "Space XSI", "yes", "n", "", "2027", "", "n", ""]);
    const a = await askOnboarding(home, ask, home);
    expect(asked[3].q).toMatch(/^'yes' reads like a yes or no, but this question needs a folder name\. Press Enter to use space-xsi, or type another name\./);
    expect(asked[4].q).toMatch(/^'n' reads like a yes or no/);
    expect(a.dir).toBe(join(home, "space-xsi"));
    setUp(a, home);
    expect(existsSync(join(home, "yes"))).toBe(false);
    expect(readFileSync(join(a.dir, "planning/company/plan.yaml"), "utf8")).toContain("name: Space XSI");
  });

  it("sets nothing up when the summary gets a no, and asks y or n again on anything else", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-no-"));
    const { ask, asked } = scripted(["2", "Tip Calc", "", "", "maybe", "y", "3", "n"]);
    await expect(askOnboarding(dir, ask, "/nowhere")).rejects.toBeInstanceOf(Cancelled);
    expect(asked[5].q).toMatch(/^Please type y for yes or n for no\./);
    expect(existsSync(join(dir, "maps", "tc"))).toBe(false);
  });

  it("checks before setting up on top of another project, and rejects a bad key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-busy-"));
    writeFileSync(join(dir, "notes.txt"), "mine\n");
    const { ask, asked } = scripted(["2", "Tip Calc", "n", "", "9X", "tc", "", "n", ""]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    expect(asked[2].q).toContain("This folder already has other files in it");
    expect(asked[3].q).toContain("Then nikOS will make a new folder for it, inside this one.");
    expect(a).toMatchObject({ kind: "spec", dir: join(dir, "tip-calc"), key: "TC" });
    expect(asked[5].q).toMatch(/^'9X' won't work as a key\. Use up to 10 letters and digits, starting with a letter\./);
  });

  it("a story map asks which company plan its code joins, never a group key or a period", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-spec-wiz-"));
    const { ask, asked } = scripted(["2", "Checkout Web", "", "acme/company-plan", "n", "y"]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    // The menu itself names groups and periods; the questions after it must not.
    const questions = asked.slice(1).map((x) => x.q).join("\n");
    expect(questions).not.toMatch(/group|period/i);
    expect(a).toEqual({ kind: "spec", dir, name: "Checkout Web", key: "CW", planRepo: "acme/company-plan", gitInit: false });
    // Not a git repo yet, so there's no origin to join through: the next step says so.
    const lines = setUp(a, dir);
    expect(lines).toContain("  2. See it in your browser: npx -y nikos@latest serve");
    expect(lines.join("\n")).toContain("  1. Link it to the company plan: set this repo's origin, then run ");
    expect(lines.join("\n")).toContain("join acme/company-plan");
    expect(existsSync(join(dir, "maps/cw/storymap.yaml"))).toBe(true);
  });

  it("a product keeps its own path: the same start, and a See it line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-product-wiz-"));
    const { ask } = scripted(["2", "Tip Calc", "TC", "", "n", ""]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    const lines = setUp(a, dir);
    expect(existsSync(join(dir, "maps/tc/storymap.yaml"))).toBe(true);
    expect(lines.some((l) => l.includes("See it in your browser: "))).toBe(true);
    expect(lines.join("\n")).not.toContain("migrate maps moves it into a group");
  });

  it("start refuses a repo that has maps/", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-start-maps-"));
    mkdirSync(join(dir, "maps"));
    expect(() => start(dir)).toThrow("This repo has maps/ (story maps). Add another story map with nikos map new, not start.");
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
    const skill = read("skills/nikos-spec/SKILL.md");
    expect(skill).toMatch(/description: Entry point for nikOS Spec, the code side of nikOS\. Use when someone has just installed nikOS or asks to set it up/);
    expect(skill).toContain("npx -y nikos@latest --version");
    const index = read("skills/nikos-spec/playbooks/index.md");
    // Second, after a new product idea, and before every playbook for a repo that's already set up.
    expect([...index.matchAll(/^\| ([\w-]+) \| `/gm)].map((m) => m[1]).slice(0, 3)).toEqual(["idea-to-blueprint", "onboard", "start"]);
    const onboard = read("skills/nikos-spec/playbooks/onboard.md");
    expect(onboard).toContain("Never set nikOS up in the home folder");
    expect(onboard).toContain("Never take one word as both the name and the key without asking");
    expect(onboard).toContain("nikos serve");
    expect(read("skills/nikos-plan/SKILL.md")).toContain("Never put company goals in `constitution.md`");
    expect(read("hooks/cursor-session-start.mjs")).toContain('["npx", ["-y", "nikos@latest"]]');
  });
});
