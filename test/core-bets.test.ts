import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Bets left the story map code for the company's planning repo (planning/<area>/bets/); the story map only keeps the links.

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(root, "src/cli.ts"), ...args], { encoding: "utf8" });

describe("bets leave core", () => {
  it("nikos bet is an unknown command and its files are gone", () => {
    const r = cli("bet", "new", "x");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown command 'bet'");
    for (const gone of ["src/commands/bet.ts", "schemas/bet.schema.json", "skills/nikos-spec/playbooks/bet.md"]) expect(existsSync(join(root, gone)), gone).toBe(false);
    expect(read("src/commands/validate.ts")).not.toMatch(/bet\.schema|checkBet|intent\/bets|join\(dir, "bets"\)/);
    expect(read("docs/format.md")).not.toContain("## bets/");
    expect(read("skills/nikos-spec/principles/index.md")).not.toMatch(/\*\*Bets are/);
    expect(read("skills/nikos-spec/playbooks/index.md")).not.toMatch(/^\| bet \|/m);
  });

  it("release notes name the breaking change and the new layout", () => {
    const notes = read("CHANGELOG.md");
    const start = notes.indexOf("### Breaking");
    expect(start).toBeGreaterThan(-1);
    const breaking = notes.slice(start, notes.indexOf("### Added", start));
    expect(breaking).toContain("nikos plan init");
    expect(breaking).toContain("maps/<key>/");
    expect(breaking).toContain("intent/");
  });
});
