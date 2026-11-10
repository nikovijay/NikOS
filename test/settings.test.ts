import { init } from "../src/commands/init";
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { describeJoin, joinPlan } from "../src/commands/join";
import { doctor } from "../src/commands/doctor";
import { companyInit } from "../src/commands/start";
import { decide } from "../src/commands/decide";
import { findDecisions, formatDecisions } from "../src/commands/decisions";
import { checkRelease } from "../src/commands/release";
import { suggest } from "../src/commands/suggest";
import { approve } from "../src/commands/approve";
import { resolveSettings, setSetting } from "../src/lib/settings";
import { copyExample, edit } from "./helpers";

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
/** A plan repo with settings, and optionally a plan above it. */
function level(settings: string, upstream?: { repo: string; url: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-level-"));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "nikos.settings.yaml"), `format_version: 1\n${settings}`);
  if (upstream) {
    mkdirSync(join(dir, "planning"));
    writeFileSync(join(dir, "planning/upstream.yaml"), `- repo: ${upstream.repo}\n  url: ${upstream.url}\n`);
  }
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "settings");
  return dir;
}
const plainRepo = () => {
  const root = dirname(copyExample());
  git(root, "init", "-q", "-b", "main");
  return root;
};

describe("settings", () => {
  it("a repo inherits through its department from the company, and can't change what's locked", () => {
    const company = level("approval:\n  policy: required-for-release\ntracker:\n  system: jira\n  site: acme.atlassian.net\nlocked: [approval.policy, tracker.system]\n");
    const dept = level("approval:\n  policy: optional\ntracker:\n  project: PAY\n  site: payments.atlassian.net\n", { repo: "acme/company-plan", url: company });
    const root = plainRepo();
    const r = joinPlan(root, { repo: "acme/engineering/payments-plan", url: dept });
    expect(r.added).toBe(true);
    expect(r.sync.synced.map((s) => [s.repo, s.via])).toEqual([["acme/engineering/payments-plan", undefined], ["acme/company-plan", "acme/engineering/payments-plan"]]);
    expect(parse(readFileSync(join(root, "planning/upstream.yaml"), "utf8"))).toEqual([{ repo: "acme/engineering/payments-plan", url: dept }]);

    const s = resolveSettings(root);
    expect(s["approval.policy"]).toEqual({ value: "required-for-release", from: "acme/company-plan", lockedBy: "acme/company-plan" });
    expect(s["tracker.system"]).toMatchObject({ value: "jira", lockedBy: "acme/company-plan" });
    expect(s["tracker.site"]).toEqual({ value: "payments.atlassian.net", from: "acme/engineering/payments-plan" });
    expect(s["tracker.project"]).toEqual({ value: "PAY", from: "acme/engineering/payments-plan" });
    expect(s["approval.routes"]).toEqual({ value: ["app", "chat", "terminal"], from: "default" });

    expect(() => setSetting(root, "approval.policy", "off")).toThrow("approval.policy is locked by acme/company-plan, so it can't be changed here");
    setSetting(root, "tracker.project", "PAY-TEAM");
    expect(resolveSettings(root)["tracker.project"]).toEqual({ value: "PAY-TEAM", from: "this repo" });
    expect(readFileSync(join(root, "nikos.settings.yaml"), "utf8")).toContain("tracker:\n  project: PAY-TEAM");
    expect(() => setSetting(root, "approval.routes", ["email"])).toThrow("approval.routes");
    expect(() => setSetting(root, "nope", 1)).toThrow("'nope' isn't a setting");

    expect(joinPlan(root, { repo: "acme/engineering/payments-plan", url: dept }).added).toBe(false);
  });

  it("join refuses a bad path and leaves upstream.yaml as it was", () => {
    const root = plainRepo();
    expect(() => joinPlan(root, { repo: "../evil" })).toThrow("is not a repo path");
    expect(() => joinPlan(root, { repo: "acme/plan", host: "https://gitlab.com/" })).toThrow("is not a host name");
    expect(readFileSync(join(root, "planning/upstream.yaml"), "utf8")).toBe("[]\n");
  });
});

describe("approval policy", () => {
  const withSettings = (yaml: string) => {
    const intent = copyExample();
    writeFileSync(join(dirname(intent), "nikos.settings.yaml"), `format_version: 1\n${yaml}`);
    return intent;
  };

  it("off: no approval in the menu, and approve refuses", () => {
    const intent = withSettings("approval:\n  policy: off\n");
    expect(suggest(intent).options.map((o) => o.label)).not.toContain("Approve HT-1: Add a task");
    expect(suggest(intent).summary).not.toContain("approval");
    expect(() => approve("HT-1", { dir: intent, by: "Niko" })).toThrow("Approvals are off here (approval.policy, set by this repo)");
  });

  it("routes: an approval given another way doesn't count", () => {
    const intent = withSettings("approval:\n  routes: [app]\n");
    expect(() => approve("HT-1", { dir: intent, by: "Niko", via: "chat" })).toThrow("Approvals in chat don't count here: approval.routes is app (set by this repo)");
  });

  it("required-for-release: a done story without a sign-off holds the release back", () => {
    const intent = withSettings("approval:\n  policy: required-for-release\n");
    edit(join(intent, "state.yaml"), (s) => s.replace("status: in_progress", "status: done"));
    expect(checkRelease({ number: 1 }, intent).gaps).toEqual(["HT-1 isn't approved", "HT-2 isn't approved"]);
    writeFileSync(join(dirname(intent), "nikos.settings.yaml"), "format_version: 1\n");
    expect(checkRelease({ number: 1 }, intent).ready).toBe(true);
  });
});

describe("doctor", () => {
  it("says what's set up and what to do next", () => {
    const root = dirname(copyExample());
    const names = (cs: ReturnType<typeof doctor>) => cs.map((c) => `${c.status} ${c.name}`);
    expect(names(doctor(root, { offline: true }))).toEqual(["ok story map", "fail scenario runner", "warn CI", "ok approvals"]);
    expect(doctor(root, { offline: true })[0].found).toBe("3 stories in 2 releases");
    const one = mkdtempSync(join(tmpdir(), "nikos-one-"));
    init(one, { name: "One", key: "ON" });
    expect(doctor(one, { offline: true })[0].found).toBe("1 story in 1 release");
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "cucumber.mjs"), "export default {};\n");
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/nikos.yml"), "name: nikos\n");
    writeFileSync(join(root, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\ntracker:\n  system: linear\n");
    const checks = doctor(root, { offline: true });
    expect(names(checks)).toEqual(["ok story map", "ok scenario runner", "ok CI", "warn approvals", "warn tracker"]);
    expect(checks[3].next).toContain("CODEOWNERS");
    writeFileSync(join(root, "CODEOWNERS"), "/intent/approvals.yaml @acme/product\n");
    expect(doctor(root, { offline: true })[3]).toMatchObject({ status: "ok", found: "required-for-release (this repo); intent/approvals.yaml needs a CODEOWNERS review" });
    expect(doctor(mkdtempSync(join(tmpdir(), "nikos-none-")))).toEqual([{ name: "story map", status: "fail", found: "no intent/ folder", next: "Set up nikOS here (nikos init), or map what the repo already does. For a company or department plan, nikos company init" }]);
    expect(existsSync(join(root, "intent"))).toBe(true);
  });
});

describe("a plan-only repo", () => {
  it("records decisions in planning/decisions.md", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-co-"));
    companyInit(root, { name: "Acme" });
    decide({ title: "Revenue is the one company key result", why: "One number everyone can see.", date: "2027-01-05" }, root);
    const text = readFileSync(join(root, "planning/decisions.md"), "utf8");
    expect(text).toMatch(/^# Decisions\n/);
    expect(text).toContain("## 2027-01-05 — Revenue is the one company key result");
    expect(existsSync(join(root, "intent"))).toBe(false);
    expect(formatDecisions("revenue", findDecisions("revenue", root), root)).toMatch(/^planning\/decisions\.md:\d+-\d+\n## 2027-01-05/);
    // A repo with neither a story map nor a plan still needs nikos init.
    expect(() => decide({ title: "x", why: "y" }, mkdtempSync(join(tmpdir(), "nikos-none-")))).toThrow(/Run `nikos init` first/);
  });

  it("passes doctor without a story map, and says when the routes aren't locked", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-co-"));
    companyInit(root, { name: "Acme", departments: ["Payments", "Growth"] });
    const names = (cs: ReturnType<typeof doctor>) => cs.map((c) => `${c.status} ${c.name}`);
    const checks = doctor(root, { offline: true });
    expect(names(checks)).toEqual(["ok plan", "ok decisions", "ok approvals", "ok plans below"]);
    expect(checks[0].found).toBe("plan-only repo: 0 key results, 0 bets; no story map needed");
    expect(checks[3].found).toBe("2 plans in planning/downstream.yaml, 2 with no repo yet");
    decide({ title: "Revenue first", why: "One number." }, root);
    expect(doctor(root, { offline: true })[1].found).toBe("1 decision in planning/decisions.md");

    writeFileSync(join(root, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\n");
    expect(doctor(root, { offline: true })[2]).toMatchObject({ status: "ok", found: "required-for-release (this repo), not locked: the plans below can change it" });
    writeFileSync(join(root, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked: [approval.policy]\n");
    expect(doctor(root, { offline: true })[2]).toMatchObject({ status: "warn", next: "Add approval.routes to locked: in nikos.settings.yaml" });
    writeFileSync(join(root, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\nlocked: [approval.policy, approval.routes]\n");
    expect(doctor(root, { offline: true })[2]).toMatchObject({ status: "ok", found: "required-for-release (this repo), locked with its routes (app, chat, terminal)" });
    expect(doctor(root, { offline: true }).some((c) => c.status === "fail")).toBe(false);
  });
});

describe("join, when the plan can't be fetched", () => {
  it("says it couldn't fetch it, keeps the entry for a later sync, and inherits nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-nojoin-"));
    const r = joinPlan(root, { repo: "acme/product/company-plan", url: join(tmpdir(), "no-such-plan-nikos") });
    expect(r.fetched).toBe(false);
    const text = describeJoin(r);
    expect(text.split("\n")[0]).toMatch(/^✗ Couldn't fetch acme\/product\/company-plan: /);
    expect(text).toContain("It's now listed in planning/upstream.yaml, but nothing comes from it until it can be fetched.");
    expect(text).not.toContain("Joined");
    expect(readFileSync(join(root, "planning/upstream.yaml"), "utf8")).toContain("acme/product/company-plan");
  });
});
