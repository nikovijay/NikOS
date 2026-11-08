import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runAssign } from "../src/commands/assign";
import { runTeam, teamJoin } from "../src/commands/team";
import { runTeamSync } from "../src/team/sync";
import { groupRepo, teamRepo, commitAll } from "./team-fixture";

const ROOT = join(__dirname, "..");

/** Run a command and collect what it prints. */
function capture(fn: () => number) {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((m: string) => out.push(m));
  const error = vi.spyOn(console, "error").mockImplementation((m: string) => err.push(m));
  const code = fn();
  log.mockRestore();
  error.mockRestore();
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("the nikos assign, team and sync commands", () => {
  it("assign prints what it did, and lists the stories nobody has yet", () => {
    const g = groupRepo("PAY");
    const r = capture(() => runAssign(["Checkout web", "--repo", "acme/checkout-web", "--releases", "1", "--dir", g]));
    expect(r.code).toBe(0);
    expect(r.out).toBe("✓ Checkout web now has 2 stories in CHK. Unassigned: 1\n  unassigned: PAY-CHK-3");
  });

  it("assign refuses bad flags with a message, not a crash", () => {
    const g = groupRepo("PAY");
    expect(capture(() => runAssign(["Checkout web", "--dir", g])).err).toContain("nikos assign needs --repo <path>");
    expect(capture(() => runAssign(["Checkout web", "--repo", "acme/a", "--releases", "one", "--dir", g])).err).toContain("'one' is not a release number");
    expect(capture(() => runAssign([])).code).toBe(1);
  });

  it("team init, member and show print their results", () => {
    const t = teamRepo("acme/checkout-web", "Checkout web");
    const added = capture(() => runTeam(["member", "add", "Priya Shah", "--role", "Lead", "--handle", "priya-s", "--dir", t]));
    expect(added).toMatchObject({ code: 0, out: "✓ Priya Shah added as Lead" });
    const removed = capture(() => runTeam(["member", "remove", "Priya Shah", "--dir", t]));
    expect(removed).toMatchObject({ code: 0, out: "✓ Priya Shah removed" });
    expect(capture(() => runTeam(["bogus"])).code).toBe(1);
  });

  it("sync prints one line per group, and refuses a repo that isn't a team's", () => {
    const g = groupRepo("PAY");
    const t = teamRepo();
    expect(capture(() => runTeamSync(["--dir", t])).out).toBe("No groups yet: nikos team join <group repo> takes work from one.");
    const url = g;
    teamJoin(t, "acme/payments/checkout-group", { url });
    commitAll(t, "join");
    const r = capture(() => runTeamSync(["--dir", t]));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^✓ acme\/payments\/checkout-group @ [0-9a-f]{7}: 0 stories for Checkout web$/);
    expect(capture(() => runTeamSync(["--dir", join(t, "..")])).err).toContain("nikos sync is for a team repo");
  });

  it("a team repo refuses a group's commands with the reason for each, and --dir with no folder is a usage error", () => {
    const t = teamRepo();
    const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "src/cli.ts"), ...args], { encoding: "utf8" });
    expect(cli("decide", "x", "--dir", t).stderr).toContain("this is a team repo: nikos decide runs in a group or plan repo");
    expect(cli("join", "acme/payments/checkout-group", "--dir", t).stderr).toContain("nikos team join <group repo>");
    expect(cli("story", "list", "--dir").stderr).toContain("--dir needs a folder");
    expect(cli("story", "list", "--dir").stderr).not.toContain("TypeError");
  });
});
