import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../src/commands/validate";

const root = join(__dirname, "../evals/validate/outputs/01-nudge");
const intent = join(root, "maps/nud");
const read = (f: string) => readFileSync(join(intent, f), "utf8");

describe("validate eval output (Nudge)", () => {
  it("is still a valid story map", () => {
    expect(validate(intent).errors).toEqual([]);
  });

  it("drafted outreach and signed off only the draft the founder said yes to", () => {
    const status = Object.fromEntries(
      readdirSync(join(intent, "outreach")).map((f) => [f, read(`outreach/${f}`).split("\n")[0]]),
    );
    expect(status).toEqual({
      "2026-11-03-email.md": "Status: draft, not sent",
      "2026-11-03-slack.md": "Status: signed off 2026-11-03, for the person to send",
    });
    expect(read("outreach/2026-11-03-slack.md")).not.toMatch(/awkward/i);
  });

  it("recorded the round under ## Validation at the end of the constitution", () => {
    const validation = readFileSync(join(root, "constitution.md"), "utf8").split("\n## Validation\n")[1];
    expect(validation).toBeDefined();
    expect(validation).not.toContain("\n## ");
    for (const part of ["Reached:** 20", "Replied:** 9", "missed", "\"I'd pay for this tomorrow"]) {
      expect(validation, part).toContain(part);
    }
    expect(readFileSync(join(root, "decisions.md"), "utf8")).toContain("never send without the freelancer's approval");
  });
});
