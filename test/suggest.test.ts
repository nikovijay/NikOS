import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSuggest, suggest } from "../src/commands/suggest";
import { setState } from "../src/commands/state";
import { specHash } from "../src/lib/project";
import { copyExample, edit } from "./helpers";

const labels = (dir: string) => suggest(dir).options.map((o) => o.label);
const capture = (args: string[]) => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  runSuggest(args);
  const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
  log.mockRestore();
  return out;
};

describe("suggest", () => {
  // The example's key result goes stale, and its bet comes due, as time passes: pin the date.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("offers to set up nikOS where there's no story map", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-empty-"));
    expect(labels(dir)).toEqual(["Set up nikOS here", "Map what this repo already does", "Join our company plan"]);
    expect(capture(["--brief", "--dir", dir])).toBe("");
  });

  it("puts unfinished work first, then approval, then the next story, at most four", () => {
    const intent = copyExample();
    const s = suggest(intent);
    expect(s.summary).toBe("Release 1 · MVP: 1 of 2 done · HT-2 in progress · 1 waiting for approval");
    expect(s.options.map((o) => o.label)).toEqual(["Finish HT-2: See today's top three", "Approve HT-1: Add a task", "Build HT-3: Reorder tasks", "Add a story"]);
    expect(s.options[1]).toMatchObject({ stories: ["HT-1"] });
    expect(s.options[1].do).toContain('"Do you want to approve <id>: <title>?"');
    expect(s.options[1].do).toContain("Only on their Approve, run nikos approve <id> --via chat");
    expect(capture(["--brief", "--dir", intent])).toBe(
      "nikOS: Release 1 · MVP: 1 of 2 done · HT-2 in progress · 1 waiting for approval. Suggested next: Finish HT-2: See today's top three · Approve HT-1: Add a task · Build HT-3: Reorder tasks · Add a story.",
    );
  });

  it("drops approval once it holds, and offers the release check when a release is complete", () => {
    const intent = copyExample();
    edit(join(intent, "state.yaml"), (s) => s.replace("status: in_progress", "status: done"));
    const hash = (f: string) => specHash(readFileSync(join(intent, "features/tasks", f), "utf8"));
    writeFileSync(
      join(intent, "approvals.yaml"),
      `format_version: 1\napprovals:\n  HT-1: { by: Niko, on: 2026-11-06, spec_hash: "${hash("add-a-task.feature")}", done_at: 2026-11-03 }\n  HT-2: { by: Niko, on: 2026-11-06, spec_hash: "${hash("see-todays-top-three.feature")}", done_at: 2026-11-03 }\n`,
    );
    expect(labels(intent)).toEqual(["Build HT-3: Reorder tasks", "Check release 1 is ready to ship", "Add a story", "Look at the story map"]);
    expect(suggest(intent).summary).toBe("Release 2 · Enhancements: 0 of 1 done");
  });

  it("leads with problems and changed specs, and says what a waiting story waits on", () => {
    const intent = copyExample();
    edit(join(intent, "state.yaml"), (s) => s.replace("status: in_progress", "status: todo").replace("plan_version: 2", "plan_version: 2\n    spec_hash: abcdefabcdef"));
    edit(join(intent, "features/tasks/see-todays-top-three.feature"), (s) => s.replace("@HT-2", "@HT-2 @depends-HT-3"));
    edit(join(intent, "features/tasks/reorder-tasks.feature"), (s) => s.replace("@HT-3", "@HT-3 @depends-HT-9"));
    expect(labels(intent)).toEqual(["Fix the 1 problem in intent/", "Review what changed in HT-1 since it was done", "Unblock HT-3 (HT-2 waits on it)", "Add a story"]);
  });

  it("offers a bet review when one is due, and a check-in when a key result is stale", () => {
    const intent = copyExample();
    edit(join(intent, "state.yaml"), (s) => s.replace("status: in_progress", "status: done"));
    const hash = (f: string) => specHash(readFileSync(join(intent, "features/tasks", f), "utf8"));
    writeFileSync(
      join(intent, "approvals.yaml"),
      `format_version: 1\napprovals:\n  HT-1: { by: Niko, on: 2026-11-06, spec_hash: "${hash("add-a-task.feature")}", done_at: 2026-11-03 }\n  HT-2: { by: Niko, on: 2026-11-06, spec_hash: "${hash("see-todays-top-three.feature")}", done_at: 2026-11-03 }\n`,
    );
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    expect(labels(intent)).toEqual(["Build HT-3: Reorder tasks", "Check release 1 is ready to ship", 'Check in on "Testers who missed an important task last week"', "Add a story"]);
    vi.setSystemTime(new Date("2026-12-02T12:00:00Z"));
    expect(labels(intent)).toEqual(["Build HT-3: Reorder tasks", "Check release 1 is ready to ship", "Review the fewer-missed-tasks bet (due 2026-12-01)", 'Check in on "Testers who missed an important task last week"']);
    expect(suggest(intent).options[2].do).toContain("review playbook");
  });

  it("skips cancelled stories", () => {
    const intent = copyExample();
    setState("HT-3", "cancelled", { dir: intent, reason: "Not now" });
    expect(labels(intent)).not.toContain("Build HT-3: Reorder tasks");
  });
});

describe("conversation rules", () => {
  const skill = readFileSync(join(__dirname, "../skills/nikos-mode/SKILL.md"), "utf8");
  const build = readFileSync(join(__dirname, "../skills/nikos-mode/playbooks/build-a-story.md"), "utf8");

  it("ends every request with nikos suggest as a short menu, and never hands over commands", () => {
    expect(skill).toContain("## 6. Ask what's next");
    expect(skill).toContain("nikos suggest --json");
    expect(skill).toContain("Never hand the person a command to run.");
  });

  it("asks before approving, and approves only on the person's answer", () => {
    for (const text of [skill, build]) {
      expect(text).toContain("Do you want to approve <");
      expect(text).toContain("--via chat");
    }
    expect(skill).toContain("Never approve on your own judgement");
  });

  it("the Claude Code plugin tells the agent where things stand at session start", () => {
    const hooks = JSON.parse(readFileSync(join(__dirname, "../hooks/hooks.json"), "utf8"));
    const cmd = hooks.hooks.SessionStart[0].hooks[0].command as string;
    expect(cmd).toContain("[ -f intent/storymap.yaml ]");
    expect(cmd).toContain("nikos suggest --brief");
    expect(cmd).toMatch(/\|\| true$/);
  });
});
