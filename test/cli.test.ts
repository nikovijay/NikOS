import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(root, "src/cli.ts"), ...args], { encoding: "utf8" });

describe("cli", () => {
  it("prints the package version for --version, -v and version", () => {
    const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const flag of ["--version", "-v", "version"]) {
      const r = cli(flag);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(version);
    }
  });
});
