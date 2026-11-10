// nikos plan serve and the delivery copies: a refresh on start unless --offline, and a refresh that fails is a
// notice on the page while the server still starts.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startPlanServe, type PlanServe } from "../src/plan/serve";
import { groupRepo, write } from "./repo-fixture";
import { acmePlan } from "./plan-serve-fixture";

let open: PlanServe[] = [];
afterEach(async () => {
  await Promise.all(open.map((p) => p.srv.close()));
  open = [];
});

async function start(repo: string, offline: boolean): Promise<PlanServe> {
  const plan = await startPlanServe(repo, { port: 0, offline });
  open.push(plan);
  return plan;
}

const pageText = async (plan: PlanServe, path: string) => (await fetch(`http://127.0.0.1:${plan.srv.port}${path}`)).text();
const indexOf = (repo: string) => join(repo, ".nikos", "delivery", "index.json");

describe("the refresh on start", () => {
  it("reads the listed code repos before it serves, unless --offline", async () => {
    const code = groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-serve-code-")));
    const repo = acmePlan(code);
    const plan = await start(repo, false);
    expect(existsSync(indexOf(repo))).toBe(true);
    expect(plan.notices).toEqual([]);
    expect(await pageText(plan, "/?at=groups/payments")).toContain("acme/payments-web");
  });

  it("reads nothing with --offline: the copies are whatever was read before", async () => {
    const repo = acmePlan(groupRepo("PAY", mkdtempSync(join(tmpdir(), "nikos-serve-code-"))));
    const plan = await start(repo, true);
    expect(existsSync(indexOf(repo))).toBe(false);
    expect(plan.notices).toEqual([]);
  });

  it("starts, and shows a listed repo that can't be read with the reason", async () => {
    const repo = acmePlan("/nowhere/missing-repo");
    const plan = await start(repo, false);
    expect(plan.notices).toEqual([]);
    expect(await pageText(plan, "/")).toContain("could not be read");
  });

  it("starts with a notice when repos.yaml won't load, and the page still shows", async () => {
    const repo = acmePlan();
    write(join(repo, "planning/repos.yaml"), "version: 2\nrepos: []\n");
    const plan = await start(repo, false);
    expect(plan.notices).toHaveLength(1);
    expect(plan.notices[0]).toContain("Couldn't read the code repos");
    const html = await pageText(plan, "/");
    expect(html).toContain("read the code repos");
    expect(html).toContain("Acme");
  });

});
