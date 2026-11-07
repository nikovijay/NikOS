import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { init } from "../src/commands/init";
import { setState } from "../src/commands/state";
import { validate } from "../src/commands/validate";
import { setupVerify, verify } from "../src/commands/verify";

// Replays docs/quickstart.md in an empty repo, using the files exactly as the
// doc shows them, so the walkthrough can't drift from what actually passes.

const doc = readFileSync(join(__dirname, "../docs/quickstart.md"), "utf8");
const repoModules = join(__dirname, "../node_modules");

/** The doc's files: a bold `path` followed by its code block. */
const files = new Map([...doc.matchAll(/\*\*`([^`]+)`\*\*:\n\n```\w*\n([\s\S]*?)```/g)].map((m) => [m[1]!, m[2]!]));

const write = (root: string, path: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), files.get(path)!);
};

describe("quickstart walkthrough", () => {
  it("names the three files a reader saves", () => {
    expect([...files.keys()]).toEqual(["intent/features/getting-started/first-story.feature", "tip.js", "test/steps/tip.steps.mjs"]);
  });

  it("only uses commands nikos has", () => {
    const commands = [...doc.matchAll(/npx -y nikos@latest (\w+)/g)].map((m) => m[1]);
    expect(new Set(commands)).toEqual(new Set(["init", "validate", "state", "verify"]));
  });

  it("the README names only commands nikos has, and links the walkthrough", () => {
    const readme = readFileSync(join(__dirname, "../README.md"), "utf8");
    const help = readFileSync(join(__dirname, "../src/cli.ts"), "utf8");
    const named = new Set([...readme.matchAll(/nikos (init|validate|clear|plan|verify|state|next|show|decide|decisions|bet|\w+)/g)].map((m) => m[1]!));
    for (const command of named) expect(help, `nikos ${command}`).toContain(`  ${command}`);
    expect(readme).toContain("docs/quickstart.md");
  });

  it("takes an empty repo to one passing scenario, then done", () => {
    const root = mkdtempSync(join(tmpdir(), "nikos-quickstart-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "tip-calculator", type: "module" }));

    // 2. init
    expect(init(root, { name: "Tip Calculator", key: "TC" }).validation.errors).toEqual([]);

    // 3. the story, still valid, then started
    write(root, "intent/features/getting-started/first-story.feature");
    expect(validate(root).errors).toEqual([]);
    setState("TC-1", "in_progress", { dir: root });

    // 4. the runner: no stale starter steps, and the story fails until its steps exist
    expect(setupVerify(root).created).toEqual(["cucumber.mjs"]);
    symlinkSync(repoModules, join(root, "node_modules"));
    const before = verify(root, "TC-1");
    expect(before.output).toContain("1 scenario (1 undefined)");
    expect(before.status).not.toBe(0);

    // 5. the code and steps from the doc make it pass
    write(root, "tip.js");
    write(root, "test/steps/tip.steps.mjs");
    const after = verify(root, "TC-1");
    expect(after.output).toContain("1 scenario (1 passed)");
    expect(after.status).toBe(0);

    // 6. done, which reruns the scenarios
    expect(setState("TC-1", "done", { dir: root }).to).toBe("done");
  }, 60_000);
});
