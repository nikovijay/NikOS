// rollout fetches each plan below into a scratch folder first. A failed fetch keeps the last good
// copy, and the note says when it was read; nothing is left behind in scratch.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rollout } from "../src/planning/rollout";
import { commitAll, companyRepo, departmentRepo } from "./planning-fixture";

describe("rollout keeps the last good copy", () => {
  it("a failed refetch shows the copy from the last good fetch, not an empty plan", () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    writeFileSync(join(co, "planning/downstream.yaml"), `- name: Payments\n  repo: acme/payments-plan\n  url: ${dept}\n`);
    commitAll(co, "downstream");
    const first = rollout(co);
    expect(first.plans[0]).toMatchObject({ name: "Payments", state: "joined" });
    const fetched = first.plans[0].fetched!;
    expect(fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    writeFileSync(join(co, "planning/downstream.yaml"), `- name: Payments\n  repo: acme/payments-plan\n  url: ${join(tmpdir(), "no-such-repo-nikos")}\n`);
    const second = rollout(co);
    const plan = second.plans[0];
    expect(plan.state).toBe("unreachable");
    expect(plan.reason).toContain(`showing the copy fetched ${fetched}`);
    expect(existsSync(join(co, ".nikos", "downstream", "acme", "payments-plan", "planning"))).toBe(true);
    const index = JSON.parse(readFileSync(join(co, ".nikos", "downstream", "index.json"), "utf8"));
    expect(index["acme/payments-plan"].fetched).toBe(fetched);
  });

  it("leaves no scratch folder behind, after a failure or a success", () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    writeFileSync(join(co, "planning/downstream.yaml"), `- name: Payments\n  repo: acme/payments-plan\n  url: ${join(tmpdir(), "no-such-repo-nikos")}\n`);
    commitAll(co, "downstream");
    rollout(co);
    const scratch = join(co, ".nikos", "downstream", ".fetch-rollout");
    expect(existsSync(scratch) ? readdirSync(scratch) : []).toEqual([]);
    writeFileSync(join(co, "planning/downstream.yaml"), `- name: Payments\n  repo: acme/payments-plan\n  url: ${dept}\n`);
    rollout(co);
    expect(existsSync(scratch) ? readdirSync(scratch) : []).toEqual([]);
  });
});
