// nikOS Plan, the review fixes: doctor --offline and validate make no network call. A spy records every git call
// the settings checks make, so a check that quietly reaches the plan's host fails here. Local bare repos only.
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const gitCalls: string[][] = [];
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: ((cmd: string, args?: readonly string[], opts?: any) => {
      if (cmd === "git") gitCalls.push([...(args ?? [])]);
      return (actual.spawnSync as any)(cmd, args, opts);
    }) as typeof actual.spawnSync,
  };
});

import { doctor } from "../src/commands/doctor";
import { validateGroup } from "../src/commands/validate";
import { addArea, initPlanRepo } from "../src/plan/repo";
import { pullPlanSettings, writeLink } from "../src/plan/settings-link";
import { bareOrigin } from "./planning-fixture";
import { codeRepo, git, groupRepo, write } from "./repo-fixture";

/** The network verbs git takes: any of these in a call means the check reached a remote. */
const NETWORK = ["ls-remote", "fetch", "clone", "pull", "push"];
const reachedNetwork = () => gitCalls.some((args) => args.some((a) => NETWORK.includes(a)));

describe("doctor --offline and validate make no network call", () => {
  it("a linked repo's offline checks never ask the plan's host, and the online check does (a control)", () => {
    const plan = mkdtempSync(join(tmpdir(), "nikos-offline-plan-"));
    git(plan, "init", "-q", "-b", "main");
    initPlanRepo(plan, { name: "Acme", year: "2027" });
    addArea(plan, "department", "finance", { name: "Finance", owner: "Mira" });
    addArea(plan, "team", "WEB", { name: "Checkout web", home: "finance" });
    write(join(plan, "planning/teams/WEB/settings.yaml"), "format_version: 1\ntracker:\n  project: WEB-TEAM\n");
    git(plan, "add", "-A");
    git(plan, "commit", "-q", "-m", "plan");
    const origin = bareOrigin();
    git(origin, "config", "uploadpack.allowFilter", "true");
    git(plan, "remote", "add", "origin", origin);
    git(plan, "push", "-q", "origin", "main");

    const code = groupRepo("WEB", codeRepo());
    writeLink(code, { format_version: 1, plan: { repo: "acme/company-plan", url: `file://${origin}` }, read: { commit: "0".repeat(40), at: new Date().toISOString() }, company: [], owners: {}, maps: {}, sha256: "" });
    pullPlanSettings(code);

    gitCalls.length = 0;
    const offline = doctor(code, { offline: true });
    validateGroup(code);
    expect(offline.find((c) => c.name === "plan settings")?.status).toBe("ok");
    expect(reachedNetwork()).toBe(false);

    gitCalls.length = 0;
    doctor(code);
    expect(reachedNetwork()).toBe(true);
  });
});
