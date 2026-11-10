import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintConstitution } from "../src/lint/constitution";
import { validate } from "../src/commands/validate";
import { copyExample, edit, rootOf } from "./helpers";

const example = readFileSync(join(__dirname, "../examples/hello-todo/constitution.md"), "utf8");
const errors = (text: string) => lintConstitution(text).filter((i) => i.level === "error").map((i) => i.message);

describe("constitution lint", () => {
  it("accepts the example and extra sections after the five", () => {
    expect(errors(example)).toEqual([]);
    expect(errors(`${example}\n## Validation\n### 2026-11-03, freelancer forum\nReached 20, 6 replied.\n`)).toEqual([]);
    expect(errors(`${example}\n## Jobs to be done\nWhen I plan my day, I want to see three things.\n\n## Founding hypothesis\nWe believe…\n`)).toEqual([]);
  });

  it("requires name and idea in the front matter", () => {
    expect(errors(example.replace(/^idea: .*\n/m, ""))).toContain("front matter is missing 'idea'");
    expect(errors(example.replace(/^---[\s\S]*?---\n/, ""))).toContain("has no front matter");
  });

  it("requires the five vision sections, in order and filled in", () => {
    expect(errors(example.replace(/## Switch\n.*\n/, ""))).toContain("is missing ## Switch");
    const swapped = example.replace("## Users", "## TMP").replace("## Problem", "## Users").replace("## TMP", "## Problem");
    expect(errors(swapped)[0]).toMatch(/^vision sections are out of order/);
    expect(errors(example.replace(/(## Proof\n).*/, "$1"))).toContain("## Proof is empty");
  });

  it("runs as part of validate", () => {
    const intent = copyExample();
    edit(join(rootOf(intent), "constitution.md"), (s) => s.replace(/## First\n.*\n/, ""));
    expect(validate(intent).errors.map((e) => `${e.file}: ${e.message}`)).toContain("constitution.md: is missing ## First");
  });
});

describe("idea-to-blueprint playbook", () => {
  const playbook = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/idea-to-blueprint.md"), "utf8");
  const index = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/index.md"), "utf8");

  it("goes from idea to a validated, CLEAR-checked spec and is routed first for new ideas", () => {
    const steps = [...playbook.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
    expect(steps).toHaveLength(10);
    for (const part of ["name", "one at a time", "contradicts", "Jobs to be done", "Founding hypothesis", "storymap.yaml", "@AC1", "only once they agree", "nikos decide", "nikos validate"]) {
      expect(steps.some((s) => s.includes(part)), part).toBe(true);
    }
    const rows = [...index.matchAll(/^\| ([\w-]+) \| `/gm)].map((m) => m[1]);
    expect(rows[0]).toBe("idea-to-blueprint");
  });
});

describe("validate playbook", () => {
  const playbook = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/validate.md"), "utf8");
  const index = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/index.md"), "utf8");
  const steps = [...playbook.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);

  it("drafts outreach and records results back into the constitution", () => {
    expect(steps).toHaveLength(9);
    for (const part of ["constitution.md", "signal that counts as proof", "maps/<key>/outreach/", "demo or reel script", "## Validation", "nikos decide", "nikos validate"]) {
      expect(steps.some((s) => s.includes(part)), part).toBe(true);
    }
    expect(index).toMatch(/^\| validate \| `validate\.md` \|.*outreach/m);
  });

  it("stops for sign-off before anything is sent, and never sends itself", () => {
    const stop = steps.findIndex((s) => s.startsWith("STOP."));
    expect(stop).toBeGreaterThan(steps.findIndex((s) => s.includes("Draft the outreach")));
    expect(stop).toBeLessThan(steps.findIndex((s) => s.includes("the person sends it")));
    expect(steps[stop]).toContain("explicit yes per draft");
    expect(steps[stop]).toContain("Needs your sign-off");
    expect(playbook).toMatch(/You never send,\s+post, email, message or schedule anything/);
  });
});
