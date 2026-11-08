import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { runState } from "../src/commands/state";
import { verify } from "../src/commands/verify";
import { groupRepo, write, feature } from "./team-fixture";

// The runner is a stand-in: each test says whether the scenarios pass.
vi.mock("../src/commands/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/commands/verify")>();
  return { ...real, verify: vi.fn(() => ({ stack: "js", command: "cucumber-js", status: 0, output: "1 scenario (1 passed)" })) };
});
const runner = vi.mocked(verify);
beforeEach(() => runner.mockClear());

const status = (dir: string, id: string) => parse(readFileSync(join(dir, "maps/chk/state.yaml"), "utf8")).stories[id].status;

function quiet() {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  return { out, err, lines: () => out.mock.calls.flat().join("\n"), errs: () => err.mock.calls.flat().join("\n"), done: () => { out.mockRestore(); err.mockRestore(); } };
}

describe("state set exit code", () => {
  it("a done move with an unrelated validation problem writes the status, prints the problem as a warning, and exits 0", () => {
    const dir = groupRepo("PAY");
    expect(runState(["set", "PAY-CHK-1", "in_progress", "--dir", dir])).toBe(0);
    // A feature for a story the map doesn't list: a problem elsewhere, not in this move.
    write(join(dir, "maps/chk/features/pay/stray.feature"), feature("PAY-CHK-9", "pay", 1, "Stray"));
    const q = quiet();
    try {
      expect(runState(["set", "PAY-CHK-1", "done", "--dir", dir])).toBe(0);
      expect(q.lines()).toMatch(/PAY-CHK-1: in_progress → done/);
      expect(q.lines()).toMatch(/^! /m);
      expect(q.errs()).toBe("");
    } finally {
      q.done();
    }
    expect(status(dir, "PAY-CHK-1")).toBe("done");
  });

  it("an error before the write (an illegal move) still exits 1 and writes nothing", () => {
    const dir = groupRepo("PAY");
    const q = quiet();
    try {
      expect(runState(["set", "PAY-CHK-2", "done", "--dir", dir])).toBe(1);
      expect(q.errs()).toMatch(/can't move from todo to done/);
    } finally {
      q.done();
    }
    expect(status(dir, "PAY-CHK-2")).toBe("todo");
  });
});
