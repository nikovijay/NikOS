// Rule 4 and decision D5: a plan's downstream entry can name the plan a team or group is homed in,
// the rollout says so, and two plans with one key are refused where they join and reported where they
// are seen together (a key names the story ids, so it has to be unique across the chain).
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDownstream, downstreamEntries, formatRollout, rollout } from "../src/planning/rollout";
import { joinPlan } from "../src/commands/join";
import { groupRepo, write, commitAll, git } from "./team-fixture";

/** A plan-only repo at a level and key, committed, so it can be joined or listed. */
function plan(level: string, key: string, name = `${level} ${key}`): string {
  const dir = mkdtempSync(join(tmpdir(), "nikos-plan-"));
  write(join(dir, "planning/plan.yaml"), `name: ${name}\nkey: ${key}\nperiod: Q1 2027\nlevel: ${level}\npillars: []\n`);
  git(dir, "init", "-q", "-b", "main");
  commitAll(dir, "plan");
  return dir;
}

describe("a downstream entry names the plan a team or group is homed in (rule 4)", () => {
  it("addDownstream writes home, downstreamEntries reads it, and the rollout says homed in", () => {
    const co = plan("company", "ACME");
    const r = addDownstream(co, { name: "Ana team", repo: "acme/ana-team", home: "acme/payments-group" });
    expect(r).toMatchObject({ name: "Ana team", repo: "acme/ana-team", added: true });
    expect(readFileSync(join(co, "planning/downstream.yaml"), "utf8")).toContain("home: acme/payments-group");
    expect(downstreamEntries(co)[0]).toMatchObject({ name: "Ana team", home: "acme/payments-group" });
    // Not fetched here: the rollout still lists it, with its home, as an entry it can't reach yet.
    const text = formatRollout(rollout(co, { offline: true }));
    expect(text).toContain("Ana team (acme/ana-team), homed in acme/payments-group");
  });

  it("refuses a home without a repo, and a home that isn't a repo path", () => {
    const co = plan("company", "ACME");
    expect(() => addDownstream(co, { name: "Ana team", home: "acme/payments-group" })).toThrow("Give the repo path too");
    expect(() => addDownstream(co, { name: "Ana team", repo: "acme/ana-team", home: "not a repo" })).toThrow("is not a repo path for --home");
    expect(existsSync(join(co, "planning/downstream.yaml"))).toBe(false);
  });

  it("a home written by hand must be a repo path too, and an entry without one is still read as before", () => {
    const co = plan("company", "ACME");
    write(join(co, "planning/downstream.yaml"), "- name: Ana team\n  repo: acme/ana-team\n  home: 'bad home'\n");
    expect(() => downstreamEntries(co)).toThrow("is not a repo path for home");
    write(join(co, "planning/downstream.yaml"), "- name: Payments\n  repo: acme/payments-plan\n");
    expect(downstreamEntries(co)[0]).toMatchObject({ name: "Payments" });
    expect(downstreamEntries(co)[0].home).toBeUndefined();
  });
});

describe("two plans with one key (decision D5)", () => {
  it("refuses a group's join to a plan with its own key, and names both", () => {
    const company = plan("company", "PAY", "Company PAY");
    const g = groupRepo("PAY");
    expect(() => joinPlan(g, { repo: "acme/company", url: company })).toThrow("uses key PAY, which this plan uses");
    expect(existsSync(join(g, "planning/upstream.yaml"))).toBe(false);
  });

  it("the rollout reports the duplicate key among the copies below it as an error line", () => {
    const co = plan("company", "ACME");
    const a = groupRepo("PAY");
    const b = groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-group-b-")));
    write(join(co, "planning/downstream.yaml"), `- name: A\n  repo: acme/a\n  url: ${a}\n- name: B\n  repo: acme/b\n  url: ${b}\n`);
    commitAll(co, "downstream");
    const r = rollout(co);
    expect(r.problems).toEqual(["key PAY is used by acme/a and acme/b: give one of them another key"]);
    expect(formatRollout(r).split("\n")[0]).toContain("have joined");
    expect(formatRollout(r)).toContain("✗ key PAY is used by acme/a and acme/b");
  });

  it("no problem when every key is its own", () => {
    const co = plan("company", "ACME");
    const a = groupRepo("PAY");
    const b = groupRepo("DEL", mkdtempSync(join(tmpdir(), "nikos-group-c-")));
    write(join(co, "planning/downstream.yaml"), `- name: A\n  repo: acme/a\n  url: ${a}\n- name: B\n  repo: acme/b\n  url: ${b}\n`);
    commitAll(co, "downstream");
    expect(rollout(co).problems).toEqual([]);
  });
});
