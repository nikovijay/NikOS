// A map's owner: the storymap field that prefixes its story ids (WEB-CHK-3), the fallback to the
// group key for a map with none, and nikos map new --owner. Each map keeps its own delivery.yaml.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { schemaProblems } from "../src/lib/schema";
import { NO_OWNER, storyPrefix, type StoryMapRef } from "../src/lib/maps";
import { newMap } from "../src/commands/map";
import { validate } from "../src/commands/validate";
import { groupRepo, write, commitAll } from "./repo-fixture";

const chk = (root: string): StoryMapRef => ({ root, dir: join(root, "maps/chk"), id: "chk" });

/** Rewrite every PAY-CHK id in a group's map, so the map is written under another prefix. */
function renameIds(g: string, from: string, to: string) {
  for (const f of ["maps/chk/storymap.yaml", "maps/chk/state.yaml", "maps/chk/features/pay/pay-by-card.feature", "maps/chk/features/pay/pay-by-wallet.feature", "maps/chk/features/confirm/see-receipt.feature"]) {
    const p = join(g, f);
    write(p, readFileSync(p, "utf8").split(from).join(to));
  }
}

/** The storymap, with an owner line added after its key. */
function setOwner(g: string, owner: string) {
  const p = join(g, "maps/chk/storymap.yaml");
  write(p, readFileSync(p, "utf8").replace("key: CHK\n", `key: CHK\nowner: ${owner}\n`));
}

const messages = (r: { errors: { message: string }[] }) => r.errors.map((e) => e.message);

describe("the owner field in storymap.yaml", () => {
  const base = { format_version: 1, project: "chk", key: "CHK", activities: [{ id: "pay", title: "Pay" }], releases: [{ number: 1, title: "First", stories: ["WEB-CHK-1"] }] };

  it("accepts an owner that is an uppercase key, and refuses anything else", () => {
    expect(schemaProblems("storymap.schema.json", { ...base, owner: "WEB" })).toEqual([]);
    expect(schemaProblems("storymap.schema.json", { ...base, owner: "CHK2" })).toEqual([]);
    for (const bad of ["web", "ABCDEFGHIJK", "WEB-1"]) expect(schemaProblems("storymap.schema.json", { ...base, owner: bad }).length).toBeGreaterThan(0);
  });

  it("names the story id prefix: the owner, then the map key, then the number", () => {
    const g = groupRepo("PAY");
    setOwner(g, "WEB");
    expect(storyPrefix(chk(g), "CHK")).toBe("WEB-CHK");
  });

  it("a story id WEB-CHK-3 is valid in a map whose owner is WEB", () => {
    const g = groupRepo("PAY");
    setOwner(g, "WEB");
    renameIds(g, "PAY-CHK", "WEB-CHK");
    const r = validate(g, "chk");
    expect(messages(r).filter((m) => m.includes("must start with") || m.includes("feature file") || m.includes("unknown story"))).toEqual([]);
  });

  it("a story id with the group's prefix is refused in a map whose owner is WEB", () => {
    const g = groupRepo("PAY");
    setOwner(g, "WEB");
    const r = messages(validate(g, "chk"));
    expect(r).toContain("story PAY-CHK-1 must start with WEB-CHK-");
    expect(r).toContain("story PAY-CHK-3 must start with WEB-CHK-");
  });

  it("a map whose owner is WEB refuses a mix of prefixes, one message per story with the other prefix", () => {
    const g = groupRepo("PAY");
    setOwner(g, "WEB");
    renameIds(g, "PAY-CHK-1", "WEB-CHK-1");
    const r = messages(validate(g, "chk"));
    expect(r).not.toContain("story WEB-CHK-1 must start with WEB-CHK-");
    expect(r).toContain("story PAY-CHK-2 must start with WEB-CHK-");
    expect(r).toContain("story PAY-CHK-3 must start with WEB-CHK-");
  });

  it("a map with no owner falls back to the group key from planning/plan.yaml", () => {
    const g = groupRepo("PAY");
    expect(storyPrefix(chk(g), "CHK")).toBe("PAY-CHK");
    expect(messages(validate(g, "chk")).filter((m) => m.includes("must start with"))).toEqual([]);
  });

  it("a map with neither an owner nor a group key says how to fix it", () => {
    const g = groupRepo("PAY");
    write(join(g, "planning/plan.yaml"), "name: Checkout\nperiod: Q1 2027\nlevel: group\npillars: []\n");
    expect(() => storyPrefix(chk(g), "CHK")).toThrow(NO_OWNER);
    expect(messages(validate(g, "chk"))).toContain(NO_OWNER);
    expect(NO_OWNER).toMatch(/owner: <KEY>/);
    expect(NO_OWNER).toMatch(/planning\/plan\.yaml/);
  });

  it("bet is optional: a map with no bet validates", () => {
    const g = groupRepo("PAY");
    const p = join(g, "maps/chk/storymap.yaml");
    write(p, readFileSync(p, "utf8").replace("bet: faster-checkout\n", ""));
    expect(messages(validate(g, "chk")).filter((m) => m.includes("bet"))).toEqual([]);
  });
});

describe("nikos map new --owner", () => {
  it("writes the owner into the new map's storymap, and its story ids take it", () => {
    const g = groupRepo("PAY");
    const r = newMap({ bet: "faster-checkout", key: "INB", owner: "WEB" }, g);
    expect(r.group).toBe("WEB");
    const sm = parse(readFileSync(join(g, "maps/inb/storymap.yaml"), "utf8"));
    expect(sm).toMatchObject({ key: "INB", owner: "WEB" });
    expect(storyPrefix({ root: g, dir: r.dir, id: "inb" }, "INB")).toBe("WEB-INB");
  });

  it("refuses an owner that isn't an uppercase key", () => {
    const g = groupRepo("PAY");
    expect(() => newMap({ bet: "faster-checkout", key: "INB", owner: "web" }, g)).toThrow("owner must be uppercase letters and digits, up to 10 (e.g. WEB)");
    expect(() => newMap({ bet: "faster-checkout", key: "INB", owner: "ABCDEFGHIJK" }, g)).toThrow("owner must be uppercase letters and digits");
  });

  it("refuses a map with no owner when the group has no key to fall back on", () => {
    const g = groupRepo("PAY");
    write(join(g, "planning/plan.yaml"), "name: Checkout\nperiod: Q1 2027\nlevel: group\npillars: []\n");
    expect(() => newMap({ bet: "faster-checkout", key: "INB" }, g)).toThrow("planning/plan.yaml has no key");
  });

  it("does not write the group key as an owner when none is given", () => {
    const g = groupRepo("PAY");
    newMap({ bet: "faster-checkout", key: "INB" }, g);
    expect(parse(readFileSync(join(g, "maps/inb/storymap.yaml"), "utf8"))).not.toHaveProperty("owner");
  });

  it("refuses a second map with the same key, and writes the new map's delivery.yaml on the spot", () => {
    const g = groupRepo("PAY");
    expect(() => newMap({ bet: "faster-checkout", key: "CHK", owner: "WEB" }, g)).toThrow("map key CHK is already used by maps/chk");
    newMap({ bet: "faster-checkout", key: "INB", owner: "WEB" }, g);
    expect(existsSync(join(g, "maps/inb/delivery.yaml"))).toBe(true);
    commitAll(g, "inb");
    expect(messages(validate(g, "inb")).filter((m) => m.includes("delivery.yaml"))).toEqual([]);
  });
});
