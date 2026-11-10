// Approval's git gates for every map in a repo: a map in a git repo with a commit can't be approved
// over changed code, and a folder with no git (or no commit yet) has no gate and no tested commit.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { approve } from "../src/commands/approve";
import { setState } from "../src/commands/state";
import { newMap } from "../src/commands/map";
import { newStory } from "../src/commands/story";
import { verify } from "../src/commands/verify";
import { codeChangedSince, headOf } from "../src/lib/git";
import { validate } from "../src/commands/validate";
import { git, write, commitAll, groupRepo } from "./repo-fixture";

vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
beforeEach(() => vi.mocked(verify).mockClear());

const approvalOf = (dir: string, id: string) => parse(readFileSync(join(dir, "maps/chk/approvals", `${id}.yaml`), "utf8"));

describe("approve in a group's repo with git", () => {
  it("writes the tested commit, and refuses once the code has changed since it was tested", () => {
    const g = groupRepo("PAY");
    write(join(g, "src/checkout.js"), "export const pay = () => {};\n");
    commitAll(g, "code");
    const tested = headOf(g)!;
    setState("PAY-CHK-1", "in_progress", { dir: g });
    setState("PAY-CHK-1", "done", { dir: g });
    commitAll(g, "done");
    approve("PAY-CHK-1", { dir: g, by: "Priya Shah", date: "2027-01-06" });
    expect(approvalOf(g, "PAY-CHK-1")).toMatchObject({ by: "Priya Shah", tested_commit: tested });

    // A second story, tested, then code changes before approval: approve says the code changed.
    write(join(g, "src/checkout.js"), "export const pay = () => 1;\n");
    commitAll(g, "more code");
    setState("PAY-CHK-2", "in_progress", { dir: g });
    setState("PAY-CHK-2", "done", { dir: g });
    commitAll(g, "done two");
    write(join(g, "src/checkout.js"), "export const pay = () => 2;\n");
    commitAll(g, "code after done");
    expect(() => approve("PAY-CHK-2", { dir: g, by: "Priya Shah" })).toThrow("the code has changed since");
  });

  it("a commit of only nikOS's own files keeps an approval current, and a later code commit brings the warning back", () => {
    const g = groupRepo("PAY");
    write(join(g, "src/checkout.js"), "export const pay = () => {};\n");
    commitAll(g, "code");
    const tested = headOf(g)!;
    setState("PAY-CHK-1", "in_progress", { dir: g });
    setState("PAY-CHK-1", "done", { dir: g });
    commitAll(g, "done");
    approve("PAY-CHK-1", { dir: g, by: "Priya Shah", date: "2027-01-06" });
    commitAll(g, "approve");
    const codeWarnings = () => validate(g, "chk").warnings.filter((w) => w.message.includes("the code has changed since it was tested"));

    // Only state, approvals and delivery.yaml change here: the code the approval tested is the same.
    setState("PAY-CHK-2", "in_progress", { dir: g });
    commitAll(g, "bookkeeping");
    expect(codeChangedSince(g, tested)).toBe(false);
    expect(codeWarnings()).toEqual([]);

    write(join(g, "src/checkout.js"), "export const pay = () => 1;\n");
    commitAll(g, "code after approval");
    expect(codeChangedSince(g, tested)).toBe(true);
    expect(codeWarnings().map((w) => w.message)).toEqual([expect.stringContaining("PAY-CHK-1")]);
  });

  it("refuses approval over uncommitted code", () => {
    const g = groupRepo("PAY");
    setState("PAY-CHK-1", "in_progress", { dir: g });
    commitAll(g, "start");
    setState("PAY-CHK-1", "done", { dir: g });
    commitAll(g, "done");
    write(join(g, "src/checkout.js"), "// not committed\n");
    expect(() => approve("PAY-CHK-1", { dir: g, by: "Priya Shah" })).toThrow("the code has uncommitted changes");
  });
});

describe("approve in a folder with no git", () => {
  it("approves without a tested commit, and skips the git checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-nogit-"));
    try {
      write(join(dir, "planning/plan.yaml"), "name: Checkout PAY\nkey: PAY\nperiod: Q1 2027\nlevel: group\npillars: []\n");
      write(join(dir, "planning/bets/faster-checkout.md"), "---\nid: faster-checkout\n---\n");
      newMap({ bet: "faster-checkout", key: "CHK", owner: "PAY" }, dir);
      newStory({ title: "Pay by card", activity: "getting-started" }, dir);
      expect(headOf(dir)).toBeUndefined();
      expect(codeChangedSince(dir, "0123456789abcdef0123456789abcdef01234567")).toBe(false);
      setState("PAY-CHK-1", "in_progress", { dir });
      setState("PAY-CHK-1", "done", { dir });
      approve("PAY-CHK-1", { dir, by: "Priya Shah", date: "2027-01-06" });
      const a = approvalOf(dir, "PAY-CHK-1");
      expect(a).toMatchObject({ by: "Priya Shah" });
      expect(a.tested_commit).toBeUndefined();
      expect(existsSync(join(dir, ".git"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("codeChangedSince is false in a repo with git but no commit yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-nohead-"));
    try {
      write(join(dir, "src/app.ts"), "export const app = 1;\n");
      git(dir, "init", "-q", "-b", "main");
      expect(headOf(dir)).toBeUndefined();
      expect(codeChangedSince(dir, "0123456789abcdef0123456789abcdef01234567")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
