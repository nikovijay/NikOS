import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { companyInit } from "../src/commands/start";
import { joinPlan } from "../src/commands/join";
import { newKr } from "../src/planning/krs";
import { addDownstream, formatRollout, ownRepo, rollout } from "../src/planning/rollout";
import { planningData } from "../src/planning/server";
import { copyExample, edit } from "./helpers";

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
const commit = (dir: string, msg = "plan") => {
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", msg);
};
const repo = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, "init", "-q", "-b", "main");
  return dir;
};

// A company plan, a department that joined it, a team below the department, and one that hasn't joined.
function company() {
  const co = repo("nikos-co-");
  git(co, "remote", "add", "origin", "https://github.com/acme/company-plan.git");
  companyInit(co, { name: "Acme", period: "Q1 2027", repo: "acme/company-plan" });
  newKr({ id: "kr-1", title: "Grow revenue", owner: "Board", baseline: 1, target: 2, by: "2027-03-31" }, co);
  commit(co);

  const dept = repo("nikos-dept-");
  mkdirSync(join(dept, "planning"));
  writeFileSync(join(dept, "planning/upstream.yaml"), `- repo: acme/company-plan\n  url: ${co}\n`);
  joinPlan(dept, { repo: "acme/company-plan" });
  newKr({ id: "pay-1", title: "Checkout conversion", owner: "Payments", baseline: 50, target: 60, by: "2027-03-31", unit: "%", alignsTo: "acme/company-plan#kr-1" }, dept);
  commit(dept);

  const team = dirname(copyExample());
  git(team, "init", "-q", "-b", "main");
  mkdirSync(join(team, "planning"), { recursive: true });
  writeFileSync(join(team, "planning/upstream.yaml"), `- repo: acme/payments-plan\n  url: ${dept}\n`);
  joinPlan(team, { repo: "acme/payments-plan" });
  commit(team);
  writeFileSync(join(dept, "planning/downstream.yaml"), `- name: Checkout\n  repo: acme/payments/checkout\n  url: ${team}\n`);
  commit(dept, "downstream");

  const loner = repo("nikos-loner-");
  writeFileSync(join(loner, "README.md"), "# Growth\n");
  commit(loner);

  writeFileSync(
    join(co, "planning/downstream.yaml"),
    `- name: Payments\n  repo: acme/payments-plan\n  url: ${dept}\n- name: Growth\n  repo: acme/growth-plan\n  url: ${loner}\n- name: Data\n  repo: acme/data-plan\n  url: ${join(tmpdir(), "no-such-repo-nikos")}\n- name: Ops\n`,
  );
  commit(co, "departments");
  return { co, dept, team };
}

describe("rollout", () => {
  it("reports every plan below: joined, synced, delivery, and what points up", () => {
    const { co } = company();
    expect(ownRepo(co)).toBe("acme/company-plan");
    const r = rollout(co);
    expect(r.repo).toBe("acme/company-plan");
    const by = Object.fromEntries(r.plans.map((p) => [p.name, p]));
    expect(r.plans.map((p) => [p.name, p.state])).toEqual([
      ["Payments", "joined"],
      ["Growth", "not joined"],
      ["Data", "unreachable"],
      ["Ops", "no repo yet"],
      ["Checkout", "joined"],
    ]);
    // Payments synced the company plan at a commit before the departments were listed: behind.
    expect(by.Payments.synced).toMatchObject({ current: false });
    expect(by.Payments.krs).toEqual([{ id: "pay-1", title: "Checkout conversion", aligns_to: "acme/company-plan#kr-1", progress: 0, stale: expect.any(Boolean), checkedIn: false }]);
    expect(by.Growth.reason).toBe("its planning/upstream.yaml doesn't list acme/company-plan yet");
    // The team joined its department, not the company, and has a story map.
    expect(by.Checkout).toMatchObject({ via: "acme/payments-plan", repo: "acme/payments/checkout" });
    // It synced the department before the department listed it, so it's behind the department.
    expect(by.Checkout.synced?.current).toBe(false);
    expect(by.Checkout.delivery?.stories).toBeGreaterThan(0);

    const text = formatRollout(r);
    expect(text.split("\n")[0]).toBe("2 of 5 plans below acme/company-plan have joined.");
    expect(text).toContain("behind this plan: ask them to run nikos planning sync");
    expect(text).toContain("behind acme/payments-plan: ask them to run nikos planning sync");
    expect(text).toContain("KR pay-1: Checkout conversion, 0%, no check-ins yet → acme/company-plan#kr-1");
    expect(readFileSync(join(co, ".gitignore"), "utf8")).toMatch(/^\.nikos\/$/m);

    // Offline reads the copies on disk, and the dashboard shows the same, without fetching.
    expect(rollout(co, { offline: true }).plans.map((p) => p.state)).toEqual(r.plans.map((p) => p.state));
    expect(planningData(co).downstream?.plans).toHaveLength(5);
  });

  it("is current once the plan below syncs again", () => {
    const { co, dept } = company();
    joinPlan(dept, { repo: "acme/company-plan" });
    commit(dept, "resync");
    expect(rollout(co).plans.find((p) => p.name === "Payments")?.synced?.current).toBe(true);
  });

  it("compares a plan further down with the plan it sits below", () => {
    const { co, dept, team } = company();
    joinPlan(team, { repo: "acme/payments-plan" });
    commit(team, "resync");
    expect(rollout(co).plans.find((p) => p.name === "Checkout")?.synced?.current).toBe(true);
    writeFileSync(join(dept, "README.md"), "# Payments\n");
    commit(dept, "moved on");
    const r = rollout(co);
    const checkout = r.plans.find((p) => p.name === "Checkout")!;
    expect(checkout).toMatchObject({ via: "acme/payments-plan", synced: { current: false } });
    expect(formatRollout(r)).toContain("behind acme/payments-plan: ask them to run nikos planning sync");
    // The dashboard reads the same copies.
    expect(planningData(co).downstream?.plans.find((p) => p.name === "Checkout")?.synced?.current).toBe(false);
  });

  it("lists a department, then gives it its repo", () => {
    const root = repo("nikos-ds-");
    companyInit(root, { name: "Acme", departments: ["Payments", "Growth"] });
    expect(addDownstream(root, { name: "Payments", repo: "acme/payments/plan", host: "gitlab.com" }).added).toBe(false);
    expect(addDownstream(root, { name: "Data" }).added).toBe(true);
    expect(parse(readFileSync(join(root, "planning/downstream.yaml"), "utf8"))).toEqual([
      { name: "Payments", repo: "acme/payments/plan", host: "gitlab.com" },
      { name: "Growth" },
      { name: "Data" },
    ]);
    expect(() => addDownstream(root, { name: "Bad", repo: "../etc" })).toThrow(/not a repo path/);
    expect(() => addDownstream(root, { name: "Ops", url: "/srv/git/ops.git" })).toThrow("Give the repo path too (--repo)");
    addDownstream(root, { name: "Ops", repo: "acme/ops-plan", url: "ssh://git@git.acme.internal/acme/ops-plan.git" });
    expect(parse(readFileSync(join(root, "planning/downstream.yaml"), "utf8")).at(-1)).toEqual({ name: "Ops", repo: "acme/ops-plan", url: "ssh://git@git.acme.internal/acme/ops-plan.git" });
    edit(join(root, "planning/downstream.yaml"), (s) => s.slice(0, s.indexOf("- name: Ops")));
    expect(rollout(root, { offline: true }).plans.map((p) => p.state)).toEqual(["unreachable", "no repo yet", "no repo yet"]);
  });
});
