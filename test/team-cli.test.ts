import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runTeam } from "../src/commands/team";
import { teamRepo } from "./team-fixture";

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

describe("the nikos team commands", () => {
  it("team init, member and show print their results", () => {
    const t = teamRepo("acme/checkout-web", "Checkout web");
    const added = capture(() => runTeam(["member", "add", "Priya Shah", "--role", "Lead", "--handle", "priya-s", "--dir", t]));
    expect(added).toMatchObject({ code: 0, out: "✓ Priya Shah added as Lead" });
    const removed = capture(() => runTeam(["member", "remove", "Priya Shah", "--dir", t]));
    expect(removed).toMatchObject({ code: 0, out: "✓ Priya Shah removed" });
    expect(capture(() => runTeam(["bogus"])).code).toBe(1);
  });

  it("a team repo refuses a group's commands with the reason for each, and --dir with no folder is a usage error", () => {
    const t = teamRepo();
    const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "src/cli.ts"), ...args], { encoding: "utf8" });
    expect(cli("decide", "x", "--dir", t).stderr).toContain("this is a team repo: nikos decide runs in a group or plan repo");
    expect(cli("story", "list", "--dir").stderr).toContain("--dir needs a folder");
    expect(cli("story", "list", "--dir").stderr).not.toContain("TypeError");
  });

  it("assign and sync are no longer commands", () => {
    const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "src/cli.ts"), ...args], { encoding: "utf8" });
    expect(cli("assign", "Checkout web").stderr).toContain("Unknown command 'assign'");
    expect(cli("sync").stderr).toContain("Unknown command 'sync'");
  });
});
