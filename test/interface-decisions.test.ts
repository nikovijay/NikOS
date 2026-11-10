import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decide } from "../src/commands/decide";
import { findDecisions } from "../src/commands/decisions";
import { copyExample, rootOf } from "./helpers";

const playbook = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/build-a-story.md"), "utf8");
const step = (n: number) => new RegExp(`^${n}\\. (.+)$`, "m").exec(playbook)![1]!;

describe("interface decisions", () => {
  it("records an interface decision that a search for interfaces finds", () => {
    const dir = copyExample();
    decide({ title: "Story ids are printed as KEY-N, one per line", why: "Scripts parse the output; JSON was rejected as noisy for people.", story: "HT-1", category: "interface", date: "2026-11-04" }, rootOf(dir));
    const found = findDecisions("interface", rootOf(dir));
    expect(found.map((d) => d.title)).toContain("2026-11-04 — Story ids are printed as KEY-N, one per line (HT-1)");
    expect(found[0]!.text).toContain("**Category:** interface");
  });

  it("plans the next story by reading interface decisions and citing the one it reuses", () => {
    expect(step(3)).toMatch(/^Run `nikos decisions interface`, then `nikos plan new <story-id>`/);
    expect(step(3)).toContain("`Reuses: <decision title> (decisions.md:<lines>)`");
    expect(step(3)).toMatch(/change one, stop and ask/);
    expect(step(7)).toContain("`--category interface`");
  });
});
