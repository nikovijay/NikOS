import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { companyInit, start } from "../src/commands/start";
import { newActivity } from "../src/commands/step";
import { joinPlan } from "../src/commands/join";
import { resolveSettings } from "../src/lib/settings";
import { validatePlanning } from "../src/planning/model";
import { copyExample } from "./helpers";

const repo = (files: Record<string, string> = {}, origin?: string) => {
  const root = mkdtempSync(join(tmpdir(), "nikos-start-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  if (origin) spawnSync("git", ["remote", "add", "origin", origin], { cwd: root });
  for (const [f, t] of Object.entries(files)) writeFileSync(join(root, f), t);
  return root;
};

describe("start", () => {
  it("sets up intent/, the runner and CI in one go, and offers what's next", () => {
    const root = repo({ "package.json": '{"name":"tip-calc"}' }, "git@github.com:acme/tip-calc.git");
    const r = start(root, { name: "Tip Calc", key: "TC" });
    expect(r.done[0]).toBe("Created intent/ for Tip Calc (1 starter story)");
    expect(r.done[1]).toMatch(/^Set up a Cucumber runner for js \(.*cucumber\.mjs.*\)\. Install it with: npm install --save-dev @cucumber\/cucumber/);
    expect(r.done[2]).toBe("Added CI for github (.github/workflows/nikos.yml, .github/workflows/nikos-release.yml)");
    expect(r.ask).toEqual([]);
    expect(r.next.options[0].label).toBe("Build TC-1: First story");
    expect(start(root).done).toEqual(["intent/ is already set up", "The js scenario runner is already set up", "CI for github is already set up"]);
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
    expect(r.join).toBe("npx -y nikos join acme/product/company-plan --host gitlab.com");
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
