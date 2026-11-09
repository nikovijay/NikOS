import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memberAdd, memberRemove, runTeam, teamInit, teamJoin, teamShow } from "../src/commands/team";
import { start } from "../src/commands/start";
import { init } from "../src/commands/init";
import { openTeam } from "../src/lib/team";
import { commitAll, groupRepo, git, teamRepo, write } from "./team-fixture";

const ROOT = join(__dirname, "..");

describe("nikos team init", () => {
  it("writes nikos.team.yaml from the origin remote", () => {
    const t = mkdtempSync(join(tmpdir(), "nikos-init-"));
    git(t, "init", "-q", "-b", "main");
    git(t, "remote", "add", "origin", "https://github.com/acme/checkout-web.git");
    expect(teamInit(t, { name: "Checkout web" })).toEqual({ repo: "acme/checkout-web", name: "Checkout web" });
    expect(openTeam(t)).toMatchObject({ name: "Checkout web", repo: "acme/checkout-web", groups: [], members: [] });
    expect(existsSync(join(t, ".gitignore"))).toBe(false);
  });

  it("refuses with intent/, with a plan, with a file already there, and with no origin and no --repo", () => {
    const withIntent = mkdtempSync(join(tmpdir(), "nikos-init-"));
    git(withIntent, "init", "-q", "-b", "main");
    init(withIntent, { name: "Old" });
    expect(() => teamInit(withIntent, { repo: "acme/x" })).toThrow("this repo has its own story map");

    // A group repo (planning/plan.yaml) with a key can't also be a team: its key would be a second plan's. A keyless one
    // stays format 1 and is allowed, as in 0.3.0 (team init --repo . in a group with no maps).
    expect(() => teamInit(groupRepo(), { repo: "acme/x", key: "PAY" })).toThrow("a plan repo can't also be a team repo");
    expect(() => teamInit(groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-init-"))), { repo: "acme/x" })).not.toThrow();
    expect(() => teamInit(teamRepo(), { repo: "acme/x" })).toThrow("nikos.team.yaml already exists here");

    const bare = mkdtempSync(join(tmpdir(), "nikos-init-"));
    git(bare, "init", "-q", "-b", "main");
    expect(() => teamInit(bare, {})).toThrow("no origin remote");
  });
});

describe("nikos team join", () => {
  it("appends the group, and refuses a repeat and a path that sits inside another", () => {
    const g = groupRepo("PAY");
    const t = teamRepo();
    expect(teamJoin(t, "acme/payments/checkout-group", { url: g })).toEqual({ repo: "acme/payments/checkout-group" });
    expect(openTeam(t).groups).toEqual([{ repo: "acme/payments/checkout-group", url: g }]);
    expect(() => teamJoin(t, "acme/payments/checkout-group", { url: g })).toThrow("already takes work from");
    expect(() => teamJoin(t, "acme/payments", { url: g })).toThrow("can't both be groups");
  });

  it("refuses a path that isn't a repo path, and a team with no nikos.team.yaml", () => {
    const t = teamRepo();
    expect(() => teamJoin(t, "not a path", {})).toThrow("is not a repo path");
    expect(() => teamJoin(mkdtempSync(join(tmpdir(), "nikos-nojoin-")), "acme/payments/checkout-group", {})).toThrow("run nikos team init first");
  });
});

describe("nikos team member", () => {
  it("adds a member with a role and a handle, refuses a duplicate, an email and a bad handle, and removes one", () => {
    const t = teamRepo();
    expect(memberAdd(t, "Priya Shah", { role: "Lead", handle: "priya-s" })).toEqual({ name: "Priya Shah", role: "Lead", handle: "priya-s" });
    expect(openTeam(t).members).toEqual([{ name: "Priya Shah", role: "Lead", handle: "priya-s" }]);
    expect(() => memberAdd(t, "Priya Shah")).toThrow("already on the team");
    expect(() => memberAdd(t, "priya@example.test")).toThrow("no email addresses");
    const before = readFileSync(join(t, "nikos.team.yaml"), "utf8");
    expect(() => memberAdd(t, "Sam Lee", { handle: "sam lee" })).toThrow();
    expect(readFileSync(join(t, "nikos.team.yaml"), "utf8")).toBe(before);
    memberRemove(t, "Priya Shah");
    expect(openTeam(t).members).toEqual([]);
    expect(() => memberRemove(t, "Priya Shah")).toThrow("isn't on the team");
  });
});

describe("nikos team show", () => {
  it("lists the team, its members, and the repos it takes work from", () => {
    const g = groupRepo("PAY");
    const t = teamRepo();
    teamJoin(t, "acme/payments/checkout-group", { url: g });
    memberAdd(t, "Priya Shah", { role: "Lead", handle: "priya-s" });
    const text = teamShow(t).join("\n");
    expect(text).toContain("Checkout web (acme/checkout-web)");
    expect(text).toContain("Priya Shah, Lead (@priya-s)");
    expect(text).toContain("  acme/payments/checkout-group");
  });
});

describe("team repos refuse a group's authoring", () => {
  it("start() doesn't set up intent/ in a team repo", () => {
    const t = teamRepo();
    expect(() => start(t)).toThrow("this is a team repo: stories are added in the group repo");
    expect(existsSync(join(t, "intent"))).toBe(false);
  });

  it("story add is refused by the CLI in a team repo", () => {
    const t = teamRepo();
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "story", "add", "Pay by card", "--dir", t], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("this is a team repo: stories are added in the group repo");
  });
});

describe("nikos team, review fixes", () => {
  it("the team file keeps block style for the groups and members it adds", () => {
    const g = groupRepo("PAY");
    const t = teamRepo();
    teamJoin(t, "acme/payments/checkout-group", { url: g });
    memberAdd(t, "Ada Lovelace", { role: "Lead" });
    const text = readFileSync(join(t, "nikos.team.yaml"), "utf8");
    expect(text).toContain("  - repo: acme/payments/checkout-group");
    expect(text).toContain("  - name: Ada Lovelace");
    expect(text).not.toMatch(/\[[^\]]/);
    expect(text).not.toContain("{");
  });

  it("team show, member add and member remove refuse a folder with no nikos.team.yaml, saying how to start", () => {
    const plain = mkdtempSync(join(tmpdir(), "nikos-plain-"));
    expect(() => teamShow(plain)).toThrow("run nikos team init first");
    expect(() => memberAdd(plain, "Ada")).toThrow("run nikos team init first");
    expect(() => memberRemove(plain, "Ada")).toThrow("run nikos team init first");
  });
});
