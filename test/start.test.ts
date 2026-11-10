import { afterEach, describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { companyInit, runStart, start } from "../src/commands/start";
import { init } from "../src/commands/init";
import { newActivity } from "../src/commands/step";
import { joinPlan } from "../src/commands/join";
import { resolveSettings } from "../src/lib/settings";
import { validatePlanning } from "../src/planning/model";
import { initPlanRepo } from "../src/plan/repo";
import { copyExample } from "./helpers";

const repo = (files: Record<string, string> = {}, origin?: string) => {
  const root = mkdtempSync(join(tmpdir(), "nikos-start-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  if (origin) spawnSync("git", ["remote", "add", "origin", origin], { cwd: root });
  for (const [f, t] of Object.entries(files)) writeFileSync(join(root, f), t);
  return root;
};

describe("start", () => {
  it("sets up maps/tc/, the runner and CI in one go, and offers what's next", () => {
    const root = repo({ "package.json": '{"name":"tip-calc"}' }, "git@github.com:acme/tip-calc.git");
    const r = start(root, { name: "Tip Calc", key: "TC" });
    expect(r.done[0]).toBe("Created maps/tc/ for Tip Calc (1 starter story)");
    expect(r.done[1]).toMatch(/^Set up a Cucumber runner for js \(.*cucumber\.mjs.*\)\. Install it with: npm install --save-dev @cucumber\/cucumber/);
    expect(r.done[2]).toBe("Added CI for github (.github/workflows/nikos.yml, .github/workflows/nikos-release.yml)");
    expect(r.ask).toEqual([]);
    expect(r.next.options[0].label).toBe("Build TC-1: First story");
    expect(() => start(root)).toThrow("This repo has maps/");
  });

  it("asks what it can't tell from the repo", () => {
    const r = start(repo());
    expect(r.done).toHaveLength(1);
    expect(r.ask.map((q) => q.split("?")[0])).toEqual(["Which language is this project in", "Is this repo on GitHub or GitLab"]);
  });
});

describe("activity add", () => {
  it("adds an activity once", () => {
    const intent = copyExample();
    expect(newActivity({ title: "Share lists" }, intent)).toBe("share-lists");
    expect(newActivity({ title: "Share lists" }, intent)).toBe("share-lists");
    expect(parse(readFileSync(join(intent, "storymap.yaml"), "utf8")).activities.map((a: any) => a.id)).toEqual(["tasks", "share-lists"]);
  });
});

describe("company init", () => {
  it("writes a company plan repo that a team can join and inherit from", () => {
    const company = repo();
    const r = companyInit(company, { name: "Acme", period: "Q1 2027", departments: ["Payments", " Growth "], repo: "acme/product/company-plan", host: "gitlab.com" });
    expect(r.created).toEqual(["planning/plan.yaml", "nikos.settings.yaml", "planning/downstream.yaml", "README.md"]);
    expect(r.join).toBe("npx -y nikos@latest join acme/product/company-plan --host gitlab.com");
    expect(parse(readFileSync(join(company, "planning/plan.yaml"), "utf8"))).toEqual({ name: "Acme", period: "Q1 2027", level: "company", pillars: [] });
    expect(parse(readFileSync(join(company, "planning/downstream.yaml"), "utf8"))).toEqual([{ name: "Payments" }, { name: "Growth" }]);
    expect(readFileSync(join(company, "README.md"), "utf8")).toContain(r.join);
    expect(existsSync(join(company, "planning/krs/.gitkeep"))).toBe(true);
    expect(validatePlanning(company)).toEqual([]);
    expect(companyInit(company, { name: "Acme" }).created).toEqual([]);

    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "add", "."], { cwd: company });
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "plan"], { cwd: company });
    const team = repo();
    start(team, { name: "Checkout", key: "CO" });
    joinPlan(team, { repo: "acme/product/company-plan", url: company });
    expect(resolveSettings(team)["approval.policy"]).toEqual({ value: "optional", from: "acme/product/company-plan" });
  });
});

/** Run nikos start from the command line's arguments, with its output captured. */
async function run(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  try {
    return { code: await runStart(args), out: out.join("\n"), err: err.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

const folder = () => mkdtempSync(join(tmpdir(), "nikos-route-"));
const savedCi = process.env.CI;

describe("nikos start with flags", () => {
  afterEach(() => {
    if (savedCi === undefined) delete process.env.CI;
    else process.env.CI = savedCi;
  });

  it("--plan writes the company's planning repo without asking, and no story map", async () => {
    const dir = folder();
    const r = await run(["--plan", "--name", "Acme", "--year", "2027", "--dir", dir]);
    expect(r.code).toBe(0);
    expect(parse(readFileSync(join(dir, "planning/company/plan.yaml"), "utf8"))).toMatchObject({ name: "Acme", period: "2027" });
    expect(existsSync(join(dir, "maps"))).toBe(false);
    expect(r.out).toContain("Add a department:");
  });

  it("--map writes maps/<key>/ without asking, and --name alone does too", async () => {
    const dir = folder();
    expect((await run(["--map", "--name", "Tip Calc", "--key", "TC", "--dir", dir])).code).toBe(0);
    expect(existsSync(join(dir, "maps/tc/storymap.yaml"))).toBe(true);
    expect(existsSync(join(dir, "planning"))).toBe(false);
    const other = folder();
    expect((await run(["--name", "Tip Calc", "--key", "TC", "--dir", other])).code).toBe(0);
    expect(existsSync(join(other, "maps/tc/storymap.yaml"))).toBe(true);
  });

  it("with no flags and no terminal, it exits 1 with usage, and writes nothing", async () => {
    process.env.CI = "1";
    const dir = folder();
    const r = await run(["--dir", dir]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("--plan");
    expect(r.err).toContain("--map");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("--plan needs the company's name, and --plan with --map picks neither", async () => {
    const dir = folder();
    expect((await run(["--plan", "--year", "2027", "--dir", dir])).err).toContain("--plan needs the company's name");
    expect((await run(["--plan", "--map", "--name", "Acme", "--year", "2027", "--dir", dir])).code).toBe(1);
    expect((await run(["--map", "--join", "--dir", dir])).err).toContain("--join needs the planning repo's path");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a repo with the old planning/plan.yaml is refused with the one-line message, and nothing is written", async () => {
    const dir = folder();
    mkdirSync(join(dir, "planning"));
    writeFileSync(join(dir, "planning/plan.yaml"), "name: Acme\nlevel: company\n");
    expect(() => start(dir)).toThrow(/^This repo has planning\/plan\.yaml, a plan of the old kind\. This version doesn't read it\./);
    expect((await run(["--map", "--dir", dir])).code).toBe(1);
    expect((await run(["--plan", "--name", "Acme", "--year", "2027", "--dir", dir])).err).toContain("a plan of the old kind");
    expect(existsSync(join(dir, "maps"))).toBe(false);
    expect(existsSync(join(dir, "planning/company"))).toBe(false);
  });

  it("the company's planning repo refuses a story map, from start and from init", async () => {
    const root = folder();
    initPlanRepo(root, { name: "Acme", year: "2027" });
    expect(() => start(root)).toThrow("This is the company's planning repo. Story maps live in code repos");
    expect(() => init(root)).toThrow("This is the company's planning repo. Story maps live in code repos");
    expect((await run(["--map", "--dir", root])).code).toBe(1);
    expect(existsSync(join(root, "maps"))).toBe(false);
  });
});
