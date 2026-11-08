import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

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
    for (const args of [["team", "init", "--help"], ["init", "-h"], ["join", "acme/plan", "--help"], ["planning", "downstream", "add", "D", "--help"]]) {
      const dir = mkdtempSync(join(tmpdir(), "nikos-help-"));
      const r = cliIn(dir, ...args);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(args[0] === "planning" ? "nikos planning" : `nikos ${args[0]}`);
      expect(readdirSync(dir)).toEqual([]);
    }
  });
});
