import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { setState } from "../src/commands/state";
import { copyExample } from "./helpers";

const playbook = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/build-a-story.md"), "utf8");

describe("claimed_by", () => {
  it("records claimed_by when the build-a-story playbook moves a story to in_progress", () => {
    const step4 = /^4\. (.+)$/m.exec(playbook)![1]!;
    expect(step4).toMatch(/^Run `nikos state set <story-id> in_progress --by <agent>`/);
    expect(step4).toMatch(/never a person/);

    // HT-3 is todo in the example; moving it as the playbook says records the agent.
    const dir = copyExample();
    setState("HT-3", "in_progress", { dir, by: "codex", date: "2026-11-04" });
    expect(parse(readFileSync(join(dir, "state.yaml"), "utf8")).stories["HT-3"]).toMatchObject({ status: "in_progress", claimed_by: "codex" });
  });
});
