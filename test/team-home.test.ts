import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teamInit } from "../src/commands/team";
import { parseTeam } from "../src/lib/team";

const empty = () => mkdtempSync(join(tmpdir(), "nikos-team-home-"));

describe("a team's key and home", () => {
  it("team init --key writes the key, at format 2 (0.3.0 can't read that)", () => {
    const dir = empty();
    teamInit(dir, { repo: "acme/web-team", name: "Web", key: "WEB" });
    const text = readFileSync(join(dir, "nikos.team.yaml"), "utf8");
    expect(text).toMatch(/^format_version: 2$/m);
    expect(text).toMatch(/^key: WEB$/m);
    expect(parseTeam(text)).toMatchObject({ format_version: 2, key: "WEB", repo: "acme/web-team" });
  });

  it("a team with no key keeps format 1, so 0.3.0 still reads its file", () => {
    const dir = empty();
    teamInit(dir, { repo: "acme/web-team", name: "Web" });
    const text = readFileSync(join(dir, "nikos.team.yaml"), "utf8");
    expect(text).toMatch(/^format_version: 1$/m);
    expect(text).not.toMatch(/^key:/m);
    expect(parseTeam(text).key).toBeUndefined();
  });

  it("refuses a key that isn't a key, the same shape a group key has", () => {
    const dir = empty();
    expect(() => teamInit(dir, { repo: "acme/web-team", key: "web" })).toThrow("'web' is not a team key");
    expect(() => teamInit(dir, { repo: "acme/web-team", key: "WAY-TOO-LONG-KEY" })).toThrow("is not a team key");
  });

  it("refuses to init a plan repo as a team", () => {
    const dir = empty();
    mkdirSync(join(dir, "planning"));
    writeFileSync(join(dir, "planning/plan.yaml"), "name: Payments\nlevel: department\n");
    expect(() => teamInit(dir, { repo: "acme/payments-plan", key: "PAY" })).toThrow("a plan repo can't also be a team repo");
  });

  it("the schema takes a home as a repo path, and refuses a bad one", () => {
    const ok = "format_version: 2\nname: A\nrepo: acme/a\nkey: WEB\nhome: acme/payments-group\n";
    expect(parseTeam(ok).home).toBe("acme/payments-group");
    expect(() => parseTeam("format_version: 2\nname: A\nrepo: acme/a\nhome: payments\n")).toThrow();
    expect(() => parseTeam("format_version: 2\nname: A\nrepo: acme/a\nkey: web\n")).toThrow();
  });
});
