import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { closest } from "../src/lib/closest";

const root = join(__dirname, "..");
const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(root, "src/cli.ts"), ...args], { encoding: "utf8" });
// Outside the repo, tsx is loaded by its path.
const tsx = pathToFileURL(join(root, "node_modules/tsx/dist/esm/index.mjs")).href;
const cliIn = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, ["--import", tsx, join(root, "src/cli.ts"), ...args], { cwd, encoding: "utf8", env: { ...process.env, NIKOS_NO_VERSION_CHECK: "1" } });

describe("cli", () => {
  it("prints the package version for --version, -v and version", () => {
    const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const flag of ["--version", "-v", "version"]) {
      const r = cli(flag);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(version);
    }
  });

  it("prints a command's help for --help and -h, and writes nothing", () => {
    for (const args of [["map", "new", "--help"], ["init", "-h"], ["join", "acme/plan", "--help"], ["plan", "kr", "--help"]]) {
      const dir = mkdtempSync(join(tmpdir(), "nikos-help-"));
      const r = cliIn(dir, ...args);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`nikos ${args[0]}`);
      expect(readdirSync(dir)).toEqual([]);
    }
  });

  it("suggests the nearest command for a typo, in two short lines and not the whole help", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-typo-"));
    const r = cliIn(dir, "serv");
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("Unknown command 'serv'. Did you mean: nikos serve?\nSee every command: nikos help\n");
    expect(cliIn(dir, "frobnicate").stderr).toBe("Unknown command 'frobnicate'.\nSee every command: nikos help\n");
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("closest", () => {
  const names = ["serve", "start", "story", "state", "doctor", "planning", "help", "approve", "validate"];
  it("finds a missing, extra, changed or swapped letter, and the start of a name", () => {
    expect(closest("serv", names)).toBe("serve");
    expect(closest("sevre", names)).toBe("serve");
    expect(closest("hlep", names)).toBe("help");
    expect(closest("doctr", names)).toBe("doctor");
    expect(closest("plan", names)).toBe("planning");
    expect(closest("approev", names)).toBe("approve");
  });
  it("says nothing when no name is close", () => {
    expect(closest("xyz", names)).toBeUndefined();
    expect(closest("deploy", names)).toBeUndefined();
  });
});
