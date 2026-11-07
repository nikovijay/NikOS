import { describe, it, expect } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askOnboarding, currentQuarter, setUp, type Ask } from "../src/commands/onboard";
import { runServeCommand } from "../src/commands/serve";
import { runCompany } from "../src/commands/start";
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
  it("won't set up in the home folder, and gives a team its own plan beside its story map", async () => {
    const home = mkdtempSync(join(tmpdir(), "nikos-home-"));
    const { ask, asked } = scripted(["", "Payments Squad", "", "", "", "acme/payments-plan", ""]);
    const a = await askOnboarding(home, ask, home);
    expect(a).toEqual({ kind: "team", dir: join(home, "payments-squad"), name: "Payments Squad", key: "PS", period: currentQuarter(), joins: "acme/payments-plan", gitInit: true });
    expect(asked.map((x) => x.q.split("\n")[0])).toEqual([
      "What are you setting up?",
      "Team name",
      "Your home folder isn't a good place for a repo. Folder to create for it",
      "Story key: every story id starts with it (PS-1), and it's hard to change later",
      "Planning period",
      "The department or company plan it works toward, as its repo path, e.g. acme/company-plan (Enter to skip)",
      "Make it a git repo? (Y/n)",
    ]);
    // A team is the default, and there's no folder name to fall back on at home.
    expect(asked[0].s).toBe("3");
    expect(asked[1].s).toBeUndefined();

    const lines = setUp(a, home);
    expect(existsSync(join(a.dir, ".git"))).toBe(true);
    expect(readFileSync(join(a.dir, "intent/storymap.yaml"), "utf8")).toContain("PS");
    expect(readFileSync(join(a.dir, "planning/plan.yaml"), "utf8")).toContain("level: team");
    // Settings and the join line belong to the plans above, not a team.
    expect(existsSync(join(a.dir, "planning/downstream.yaml"))).toBe(false);
    expect(lines).toContain("See it: cd payments-squad && npx -y nikos@latest serve");
    expect(lines).toContain("  Once acme/payments-plan is reachable from here, link this plan to it with: npx -y nikos@latest join acme/payments-plan");
  });

  it("sets a company plan up with no story map, and asks again on an answer it can't use", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-co-"));
    const { ask, asked } = scripted(["4", "company", "Acme", "Q1 2027", "Payments, Growth", "n"]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    expect(asked[1].q).toMatch(/^Please choose 1, 2 or 3\. What are you setting up\?/);
    expect(a).toEqual({ kind: "company", dir, name: "Acme", period: "Q1 2027", departments: ["Payments", "Growth"], gitInit: false });
    const lines = setUp(a, dir);
    expect(existsSync(join(dir, "intent"))).toBe(false);
    expect(readFileSync(join(dir, "planning/plan.yaml"), "utf8")).toContain("level: company");
    expect(readFileSync(join(dir, "planning/downstream.yaml"), "utf8")).toContain("Payments");
    expect(lines[0]).toMatch(/^✓ Wrote the company plan .+It has no story map: teams spec their bets into stories in their own repos\.$/);
    expect(lines.at(-2)).toBe("See it: npx -y nikos@latest serve");
  });

  it("sets a department plan up with no story map, below the company", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-dept-"));
    const { ask, asked } = scripted(["2", "Payments", "Q1 2027", "Checkout, Refunds", "acme/company-plan", "n"]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    expect(asked[3].q).toMatch(/^Teams that will plan against it/);
    expect(a).toEqual({ kind: "department", dir, name: "Payments", period: "Q1 2027", departments: ["Checkout", "Refunds"], joins: "acme/company-plan", gitInit: false });
    setUp(a, dir);
    expect(existsSync(join(dir, "intent"))).toBe(false);
    expect(readFileSync(join(dir, "planning/plan.yaml"), "utf8")).toContain("level: department");
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain('ask your agent to "join our department plan"');
  });

  it("checks before setting up on top of another project, and rejects a bad key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-busy-"));
    writeFileSync(join(dir, "notes.txt"), "mine\n");
    const { ask, asked } = scripted(["3", "Tip Calc", "", "", "9X", "tc", "", "", "n"]);
    const a = await askOnboarding(dir, ask, "/nowhere");
    expect(asked[2].q).toContain("This folder already has files in it");
    expect(a).toMatchObject({ kind: "team", dir: join(dir, "tip-calc"), key: "TC" });
    expect(asked[5].q).toMatch(/^Letters and digits/);
  });

  it("company init writes a company or department plan, never a team's", () => {
    expect(runCompany(["init", "--name", "Squad", "--level", "team", "--dir", mkdtempSync(join(tmpdir(), "nikos-lvl-"))])).toBe(1);
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
    expect(onboard).toContain("never put a story map in a company or department plan");
    expect(onboard).toContain("nikos serve");
    expect(read("tools/planning/skills/nikos-planning/SKILL.md")).toContain("Never put company goals in `intent/constitution.md`");
    expect(read("hooks/cursor-session-start.mjs")).toContain('["npx", ["-y", "nikos@latest"]]');
  });
});
