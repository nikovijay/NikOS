// What counts as code for an approval's tested commit, in a real git repo: a map's own state,
// approvals and delivery summary are bookkeeping, so changing them never lapses an approval.
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeChangedSince, codeIsDirty, headOf, unrelatedDirty } from "../src/lib/git";
import { git, write, commitAll } from "./repo-fixture";

/** A repo with code and one map's files, committed; returns the repo and the commit the proof ran at. */
function repo(): { dir: string; tested: string } {
  const dir = mkdtempSync(join(tmpdir(), "nikos-bookkeeping-"));
  write(join(dir, "src/app.ts"), "export const app = 1;\n");
  write(join(dir, "maps/chk/state.yaml"), "format_version: 1\nstories: {}\n");
  write(join(dir, "maps/chk/approvals/PAY-CHK-1.yaml"), "by: Priya\n");
  write(join(dir, "maps/chk/delivery.yaml"), "format_version: 1\n");
  git(dir, "init", "-q", "-b", "main");
  commitAll(dir, "code");
  return { dir, tested: headOf(dir)! };
}

describe("bookkeeping never counts as code", () => {
  it("a commit that changes only a map's state, approvals or delivery summary is not a code change", () => {
    const { dir, tested } = repo();
    write(join(dir, "maps/chk/state.yaml"), "format_version: 1\nstories:\n  PAY-CHK-1: { status: done }\n");
    write(join(dir, "maps/chk/approvals/PAY-CHK-1.yaml"), "by: Ada\n");
    write(join(dir, "maps/chk/delivery.yaml"), "format_version: 1\nread_at: now\n");
    write(join(dir, "maps/chk/state/PAY-CHK-2.yaml"), "status: todo\n");
    write(join(dir, "maps/chk/approvals/PAY-CHK-2.yaml"), "by: Ada\n");
    write(join(dir, "maps/chk/approvals.yaml"), "approvals: {}\n");
    write(join(dir, ".nikos/upstream/x.txt"), "cache\n");
    commitAll(dir, "status only");
    expect(codeChangedSince(dir, tested)).toBe(false);
  });

  it("a commit that changes the code does count", () => {
    const { dir, tested } = repo();
    write(join(dir, "src/app.ts"), "export const app = 2;\n");
    commitAll(dir, "code");
    expect(codeChangedSince(dir, tested)).toBe(true);
  });

  it("a commit that changes the code and a map's state counts, because of the code", () => {
    const { dir, tested } = repo();
    write(join(dir, "maps/chk/state.yaml"), "format_version: 1\nstories:\n  PAY-CHK-1: { status: done }\n");
    write(join(dir, "src/app.ts"), "export const app = 3;\n");
    commitAll(dir, "both");
    expect(codeChangedSince(dir, tested)).toBe(true);
  });

  it("uncommitted code is dirty, and uncommitted bookkeeping alone is not", () => {
    const { dir } = repo();
    expect(codeIsDirty(dir)).toBe(false);
    write(join(dir, "maps/chk/state.yaml"), "format_version: 1\nstories:\n  PAY-CHK-1: { status: done }\n");
    write(join(dir, "maps/chk/delivery.yaml"), "format_version: 1\nread_at: now\n");
    expect(codeIsDirty(dir)).toBe(false);
    write(join(dir, "src/app.ts"), "export const app = 4;\n");
    expect(codeIsDirty(dir)).toBe(true);
  });

  it("a folder that isn't a git repo is not dirty", () => {
    expect(codeIsDirty(mkdtempSync(join(tmpdir(), "nikos-nogit-")))).toBe(false);
  });

  it("the repo's root decisions.md and constitution.md are bookkeeping: editing them never lapses an approval", () => {
    const { dir, tested } = repo();
    write(join(dir, "decisions.md"), "# Decisions\n\n## 2027-01-06 — Cards only\n");
    write(join(dir, "constitution.md"), "# Constitution\n");
    expect(codeIsDirty(dir)).toBe(false);
    expect(unrelatedDirty(dir)).toEqual([]);
    commitAll(dir, "decide");
    expect(codeChangedSince(dir, tested)).toBe(false);
  });

  it("a root file that isn't nikOS's own is unrelated dirt, and a code change still counts", () => {
    const { dir, tested } = repo();
    write(join(dir, "notes.txt"), "scratch\n");
    expect(unrelatedDirty(dir)).toEqual(["?? notes.txt"]);
    write(join(dir, "src/app.ts"), "export const app = 5;\n");
    commitAll(dir, "code");
    expect(codeChangedSince(dir, tested)).toBe(true);
  });
});
