import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { spawnSync } from "node:child_process";
import { assign } from "../src/commands/assign";
import { teamJoin } from "../src/commands/team";
import { teamSync, readAssignedLock } from "../src/team/sync";
import { next } from "../src/commands/next";
import { groupRepo, git, teamRepo, write, commitAll } from "./team-fixture";

const copy = (team: string, repo = "acme/payments/checkout-group") => join(team, ".nikos/assigned", repo);

describe("nikos sync", () => {
  it("copies only the team's stories, with the bets, and no plans, state or git", () => {
    const g = groupRepo("PAY");
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    commitAll(g, "assign");
    const t = teamRepo();
    teamJoin(t, "acme/payments/checkout-group", { url: g });

    const dir = copy(t);
    expect(existsSync(join(dir, "maps/chk/features/pay/pay-by-card.feature"))).toBe(true);
    expect(existsSync(join(dir, "maps/chk/features/pay/pay-by-wallet.feature"))).toBe(true);
    expect(existsSync(join(dir, "maps/chk/features/confirm"))).toBe(false);
    const storymap = parse(readFileSync(join(dir, "maps/chk/storymap.yaml"), "utf8"));
    expect(storymap.releases.map((r: any) => r.stories)).toEqual([["PAY-CHK-1", "PAY-CHK-2"], []]);
    expect(storymap.activities.map((a: any) => a.id)).toEqual(["pay", "confirm"]);
    expect(existsSync(join(dir, "planning/plan.yaml"))).toBe(true);
    expect(existsSync(join(dir, "planning/bets/faster-checkout.md"))).toBe(true);
    expect(existsSync(join(dir, "maps/chk/state.yaml"))).toBe(false);
    expect(existsSync(join(dir, "maps/chk/state"))).toBe(false);
    expect(existsSync(join(dir, ".git"))).toBe(false);
    expect(existsSync(join(dir, "planning/plans"))).toBe(false);

    const lock = readAssignedLock(t);
    expect(lock[0]).toMatchObject({ repo: "acme/payments/checkout-group", ref: "main" });
    expect(lock[0].commit).toBe(git(g, "rev-parse", "HEAD"));

    // The team repo only shows its own files as changed: the copy is gitignored.
    commitAll(t, "team");
    expect(git(t, "status", "--porcelain")).toBe("");
  });

  it("gives two teams disjoint copies", () => {
    const g = groupRepo("PAY");
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    assign(g, "Checkout api", { repo: "acme/checkout-api", releases: [2] });
    commitAll(g, "assign");
    const a = teamRepo("acme/checkout-web", "Checkout web");
    const b = teamRepo("acme/checkout-api", "Checkout api");
    teamJoin(a, "acme/payments/checkout-group", { url: g });
    teamJoin(b, "acme/payments/checkout-group", { url: g });
    expect(existsSync(join(copy(a), "maps/chk/features/confirm"))).toBe(false);
    expect(existsSync(join(copy(b), "maps/chk/features/confirm/see-receipt.feature"))).toBe(true);
    expect(existsSync(join(copy(b), "maps/chk/features/pay"))).toBe(false);
  });

  it("doesn't follow the group's own upstream.yaml", () => {
    const g = groupRepo("PAY");
    write(join(g, "planning/upstream.yaml"), "- repo: acme/company-plan\n  url: /nowhere/at/all\n");
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    commitAll(g, "assign");
    const t = teamRepo();
    const r = teamJoin(t, "acme/payments/checkout-group", { url: g });
    expect(r.unresolved).toBeUndefined();
    expect(existsSync(join(t, ".nikos/assigned/acme/company-plan"))).toBe(false);
    expect(readAssignedLock(t).map((l) => l.repo)).toEqual(["acme/payments/checkout-group"]);
  });

  it("keeps the last copy and reports an unreachable group", () => {
    const g = groupRepo("PAY");
    assign(g, "Checkout web", { repo: "acme/checkout-web", releases: [1] });
    commitAll(g, "assign");
    const t = teamRepo();
    teamJoin(t, "acme/payments/checkout-group", { url: g });
    const before = readAssignedLock(t);

    rmSync(g, { recursive: true, force: true });
    const r = teamSync(t);
    expect(r.groups).toEqual([expect.objectContaining({ repo: "acme/payments/checkout-group", unresolved: expect.any(String) })]);
    expect(existsSync(join(copy(t), "maps/chk/features/pay/pay-by-card.feature"))).toBe(true);
    expect(readAssignedLock(t)).toEqual(before);
  });

  it("marks stories another team now holds as reassigned, and drops them from the old team's next", () => {
    const g = groupRepo("PAY");
    assign(g, "Checkout web", { repo: "acme/checkout-web" }); // the whole map
    commitAll(g, "assign");
    const web = teamRepo("acme/checkout-web", "Checkout web");
    teamJoin(web, "acme/payments/checkout-group", { url: g });
    write(join(web, "status/PAY-CHK-1.yaml"), "status: done\nupdated: 2027-01-05\nspec_hash: 0123456789ab\n");
    write(join(web, "status/PAY-CHK-2.yaml"), "status: in_progress\nupdated: 2027-01-05\n");
    commitAll(web, "status");

    // PAY-CHK-1 is done in the group's map, so it moves only with --include-done.
    write(join(g, "maps/chk/state.yaml"), "format_version: 1\nstories:\n  PAY-CHK-1: { status: done }\n  PAY-CHK-2: { status: in_progress }\n  PAY-CHK-3: { status: todo }\n");
    commitAll(g, "state");
    assign(g, "Checkout api", { repo: "acme/checkout-api", stories: ["PAY-CHK-1", "PAY-CHK-2"], includeDone: true });
    commitAll(g, "move");

    const api = teamRepo("acme/checkout-api", "Checkout api");
    teamJoin(api, "acme/payments/checkout-group", { url: g });
    expect(existsSync(join(copy(api), "maps/chk/features/pay/pay-by-card.feature"))).toBe(true);
    expect(git(api, "status", "--porcelain")).toContain("nikos.team.yaml");
    expect(existsSync(join(api, "status"))).toBe(false); // the new team starts with no status

    const sync = teamSync(web);
    expect(sync.marked).toEqual([
      { id: "PAY-CHK-1", to: "Checkout api" },
      { id: "PAY-CHK-2", to: "Checkout api" },
    ]);
    const marked = parse(readFileSync(join(web, "status/PAY-CHK-1.yaml"), "utf8"));
    expect(marked).toMatchObject({ status: "done", reassigned_to: "Checkout api" });
    expect(marked.reassigned_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The old team no longer has the two stories, so next passes them over.
    const webNext = next(web);
    expect(webNext.story).toBe("PAY-CHK-3");
    expect(webNext.open).toEqual([]);

    // The new team starts both at todo, with no status file.
    expect(next(api).story).toBe("PAY-CHK-1");
    expect(existsSync(join(api, "status/PAY-CHK-1.yaml"))).toBe(false);
  });
});

/** Two teams on one map: Checkout web takes the whole map, then Checkout api takes PAY-CHK-1 and -2. */
function webAndApi() {
  const g = groupRepo("PAY");
  assign(g, "Checkout web", { repo: "acme/checkout-web" });
  commitAll(g, "assign");
  const web = teamRepo("acme/checkout-web", "Checkout web");
  teamJoin(web, "acme/payments/checkout-group", { url: g });
  write(join(web, "status/PAY-CHK-1.yaml"), "status: done\nupdated: 2027-01-05\nspec_hash: 0123456789ab\n");
  write(join(web, "status/PAY-CHK-2.yaml"), "status: in_progress\nupdated: 2027-01-05\n");
  commitAll(web, "status");
  write(join(g, "maps/chk/state.yaml"), "format_version: 1\nstories:\n  PAY-CHK-1: { status: done }\n  PAY-CHK-2: { status: in_progress }\n  PAY-CHK-3: { status: todo }\n");
  commitAll(g, "state");
  assign(g, "Checkout api", { repo: "acme/checkout-api", stories: ["PAY-CHK-1", "PAY-CHK-2"], includeDone: true });
  commitAll(g, "move");
  return { g, web };
}

describe("nikos sync, changes between syncs", () => {
  it("a mark already in a status file keeps its date, and isn't reported again", () => {
    const { web } = webAndApi();
    expect(teamSync(web).marked).toHaveLength(2);
    const file = join(web, "status/PAY-CHK-1.yaml");
    write(file, readFileSync(file, "utf8").replace(/reassigned_on: \S+/, "reassigned_on: 2020-01-02"));
    expect(teamSync(web).marked).toEqual([]);
    expect(parse(readFileSync(file, "utf8")).reassigned_on).toBe("2020-01-02");
  });

  it("a story that comes back to the team has its mark cleared", () => {
    const { g, web } = webAndApi();
    teamSync(web);
    assign(g, "Checkout web", { repo: "acme/checkout-web", stories: ["PAY-CHK-1", "PAY-CHK-2"], includeDone: true });
    commitAll(g, "move back");
    const r = teamSync(web);
    expect(r.cleared.sort()).toEqual(["PAY-CHK-1", "PAY-CHK-2"]);
    expect(parse(readFileSync(join(web, "status/PAY-CHK-1.yaml"), "utf8")).reassigned_to).toBeUndefined();
    // PAY-CHK-1 is done and PAY-CHK-2 is in progress again: nothing is left to start.
    expect(next(web).open.map((o) => o.id)).toEqual(["PAY-CHK-2"]);
  });

  it("a group taken out of the team file loses its copy and its lock entry", () => {
    const g = groupRepo("PAY");
    assign(g, "Checkout web", { repo: "acme/checkout-web" });
    commitAll(g, "assign");
    const t = teamRepo();
    teamJoin(t, "acme/payments/checkout-group", { url: g });
    expect(existsSync(copy(t))).toBe(true);
    write(join(t, "nikos.team.yaml"), "format_version: 1\nname: Checkout web\nrepo: acme/checkout-web\ngroups: []\nmembers: []\n");
    teamSync(t);
    expect(existsSync(copy(t))).toBe(false);
    expect(readAssignedLock(t)).toEqual([]);
  });

  it("refuses a team file that lists one group inside another, before fetching anything", () => {
    const t = teamRepo();
    write(join(t, "nikos.team.yaml"), "format_version: 1\nname: Checkout web\nrepo: acme/checkout-web\ngroups:\n  - repo: acme/payments/checkout-group\n    url: /nowhere\n  - repo: acme/payments\n    url: /nowhere\nmembers: []\n");
    expect(() => teamSync(t)).toThrow("acme/payments and acme/payments/checkout-group can't both be groups");
  });
});

