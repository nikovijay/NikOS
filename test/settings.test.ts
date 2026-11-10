import { init } from "../src/commands/init";
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { doctor } from "../src/commands/doctor";
import { initPlanRepo } from "../src/plan/repo";
import { decide } from "../src/commands/decide";
import { findDecisions, formatDecisions } from "../src/commands/decisions";
import { checkRelease } from "../src/commands/release";
import { suggest } from "../src/commands/suggest";
import { approve } from "../src/commands/approve";
import { layerSettings, resolveSettings, setSetting } from "../src/lib/settings";
import { copyExample, edit, rootOf } from "./helpers";

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
/** A repo's own nikos.settings.yaml, committed. */
function settingsRepo(settings: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-level-"));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "nikos.settings.yaml"), `format_version: 1\n${settings}`);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "settings");
  return dir;
}
const plainRepo = () => {
  const root = rootOf(copyExample());
  git(root, "init", "-q", "-b", "main");
  return root;
};

describe("settings", () => {
  it("a code repo reads only its own nikos.settings.yaml: nothing is inherited into it", () => {
    const root = settingsRepo("approval:\n  policy: required-for-release\ntracker:\n  system: jira\n  site: acme.atlassian.net\nlocked: [approval.policy]\n");
    const s = resolveSettings(root);
    expect(s["approval.policy"]).toEqual({ value: "required-for-release", from: "this repo", lockedBy: "this repo" });
    expect(s["tracker.system"]).toEqual({ value: "jira", from: "this repo" });
    expect(s["tracker.project"]).toEqual({ value: "", from: "default" });
    expect(s["approval.routes"]).toEqual({ value: ["app", "chat", "terminal"], from: "default" });

    expect(() => setSetting(root, "approval.policy", "off")).not.toThrow();
    setSetting(root, "tracker.project", "PAY-TEAM");
    expect(resolveSettings(root)["tracker.project"]).toEqual({ value: "PAY-TEAM", from: "this repo" });
    expect(readFileSync(join(root, "nikos.settings.yaml"), "utf8")).toContain("project: PAY-TEAM");
    expect(() => setSetting(root, "approval.routes", ["email"])).toThrow("approval.routes");
    expect(() => setSetting(root, "nope", 1)).toThrow("'nope' isn't a setting");
  });

  it("layers levels top-down: a locked key stays put, and a lower level's change to it is ignored and reported", () => {
    const company = { label: "company", data: { approval: { policy: "required-for-release" }, tracker: { system: "linear" }, locked: ["approval.policy"] } };
    const team = { label: "teams/WEB", data: { approval: { policy: "off" }, tracker: { system: "jira", project: "PAY" } } };
    const r = layerSettings([company, team]);
    expect(r.resolved["approval.policy"]).toEqual({ value: "required-for-release", from: "company", lockedBy: "company" });
    expect(r.resolved["tracker.system"]).toEqual({ value: "jira", from: "teams/WEB" });
    expect(r.resolved["tracker.project"]).toEqual({ value: "PAY", from: "teams/WEB" });
    expect(r.ignored).toEqual([{ key: "approval.policy", level: "teams/WEB", lockedBy: "company" }]);
    expect(layerSettings([]).resolved["approval.policy"]).toEqual({ value: "optional", from: "default" });
  });

  it("a code repo's own file can't change a key locked above: its value is ignored and reported", () => {
    const above = { label: "acme/company-plan company", data: { approval: { policy: "off" }, locked: ["approval.policy"] } };
    const own = { label: "this repo", data: { approval: { policy: "required-for-release" }, tracker: { system: "jira" }, locked: ["tracker.system"] } };
    const r = layerSettings([above, own]);
    expect(r.resolved["approval.policy"]).toEqual({ value: "off", from: "acme/company-plan company", lockedBy: "acme/company-plan company" });
    expect(r.resolved["tracker.system"]).toEqual({ value: "jira", from: "this repo", lockedBy: "this repo" });
    expect(r.ignored).toEqual([{ key: "approval.policy", level: "this repo", lockedBy: "acme/company-plan company" }]);
  });
});

describe("approval policy", () => {
  const withSettings = (yaml: string) => {
    const intent = copyExample();
    writeFileSync(join(rootOf(intent), "nikos.settings.yaml"), `format_version: 1\n${yaml}`);
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
    writeFileSync(join(rootOf(intent), "nikos.settings.yaml"), "format_version: 1\n");
    expect(checkRelease({ number: 1 }, intent).ready).toBe(true);
  });
});

describe("doctor", () => {
  it("says what's set up and what to do next", () => {
    const root = rootOf(copyExample());
    const names = (cs: ReturnType<typeof doctor>) => cs.map((c) => `${c.status} ${c.name}`);
    // A code repo's checks: the scenario runner, CI, the story map and the approvals.
    expect(names(doctor(root, { offline: true }))).toEqual(["fail scenario runner", "warn CI", "ok story map", "ok approvals"]);
    expect(doctor(root, { offline: true }).find((c) => c.name === "story map")!.found).toBe("3 stories in 1 map");
    const one = mkdtempSync(join(tmpdir(), "nikos-one-"));
    init(one, { name: "One", key: "ON" });
    expect(doctor(one, { offline: true }).find((c) => c.name === "story map")!.found).toBe("1 story in 1 map");
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "cucumber.mjs"), "export default {};\n");
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/nikos.yml"), "name: nikos\n");
    writeFileSync(join(root, "nikos.settings.yaml"), "format_version: 1\napproval:\n  policy: required-for-release\ntracker:\n  system: linear\n");
    const checks = doctor(root, { offline: true });
    expect(names(checks)).toEqual(["ok scenario runner", "ok CI", "ok story map", "warn approvals", "warn tracker"]);
    expect(checks[3].next).toContain("CODEOWNERS");
    writeFileSync(join(root, "CODEOWNERS"), "/maps/*/approvals/ @acme/product\n");
    expect(doctor(root, { offline: true })[3]).toMatchObject({ status: "ok", found: "required-for-release (this repo); maps/<key>/approvals/ needs a CODEOWNERS review" });
    expect(doctor(mkdtempSync(join(tmpdir(), "nikos-none-")))).toEqual([{ name: "story map", status: "fail", found: "no maps/ folder", next: "Set up nikOS here (nikos init), or map what the repo already does" }]);
    expect(existsSync(join(root, "maps", "ht"))).toBe(true);
  });
});

describe("a planning repo", () => {
  it("records decisions in the company's planning/company/decisions.md", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-co-"));
    initPlanRepo(root, { name: "Acme", year: "2027" });
    decide({ title: "Revenue is the one company key result", why: "One number everyone can see.", date: "2027-01-05" }, root);
    const text = readFileSync(join(root, "planning/company/decisions.md"), "utf8");
    expect(text).toMatch(/^# Acme: decisions\n/);
    expect(text).toContain("## 2027-01-05 — Revenue is the one company key result");
    expect(existsSync(join(root, "maps", "ht"))).toBe(false);
    expect(formatDecisions("revenue", findDecisions("revenue", root), root)).toMatch(/^planning\/company\/decisions\.md:\d+-\d+\n## 2027-01-05/);
    // A repo with neither a story map nor a plan still needs nikos init.
    expect(() => decide({ title: "x", why: "y" }, mkdtempSync(join(tmpdir(), "nikos-none-")))).toThrow(/Run `nikos init` first/);
  });

  it("is checked as a plan, with its code repos and decisions", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-co-"));
    initPlanRepo(root, { name: "Acme", year: "2027" });
    const names = (cs: ReturnType<typeof doctor>) => cs.map((c) => `${c.status} ${c.name}`);
    const checks = doctor(root, { offline: true });
    expect(names(checks)).toEqual(["ok plan", "ok code repos", "ok decisions"]);
    expect(checks[2].found).toBe("none recorded yet");
    decide({ title: "Revenue first", why: "One number." }, root);
    expect(doctor(root, { offline: true })[2].found).toBe("1 decision in planning/company/decisions.md");
  });
});
