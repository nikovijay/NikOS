// nikos plan serve from the command line: the options it takes, the refusals, and the page it writes with
// --export. The server itself is not started here: its blocking run waits for Ctrl+C.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPlanRepo } from "../src/plan/cli";
import { acmePlan } from "./plan-serve-fixture";

afterEach(() => vi.restoreAllMocks());

async function run(args: string[]) {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const err = vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.join(" ")));
  try {
    return { code: await runPlanRepo(args), out: out.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

const target = () => join(mkdtempSync(join(tmpdir(), "nikos-serve-out-")), "page.html");

describe("nikos plan serve from the command line", () => {
  it("exports one area's page to a file, offline, with no form and no request in it", async () => {
    const repo = acmePlan();
    const out = target();
    const r = await run(["serve", "--dir", repo, "--at", "departments/finance", "--export", out, "--offline"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Saved the plan page: ${out}`);
    const html = readFileSync(out, "utf8");
    expect(html).toContain("Close days");
    expect(html).not.toContain("<form");
    // The page's own script only moves between the pages in the file; it asks for nothing.
    expect(html).not.toContain("<script src");
    expect(html).not.toContain("fetch(");
  });

  it("exports the company's page when no --at is given", async () => {
    const repo = acmePlan();
    const out = target();
    expect((await run(["serve", "--dir", repo, "--export", out, "--offline"])).code).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("Acme");
  });

  it("refuses an option it doesn't know, and writes nothing", async () => {
    const repo = acmePlan();
    const out = target();
    const r = await run(["serve", "--dir", repo, "--prot", "4000", "--export", out, "--offline"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Unknown option --prot for plan serve");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses an --at that is not an area, and lists the areas it has", async () => {
    const repo = acmePlan();
    const r = await run(["serve", "--dir", repo, "--at", "nowhere", "--export", target(), "--offline"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("There's no area called 'nowhere'");
    expect(r.out).toContain("The areas are:");
  });

  it("refuses a --port that is not a port number", async () => {
    const r = await run(["serve", "--dir", acmePlan(), "--port", "abc"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("--port takes a port number");
  });

  it("runs only in a planning repo", async () => {
    const r = await run(["serve", "--dir", mkdtempSync(join(tmpdir(), "nikos-serve-none-")), "--offline"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("This isn't a planning repo");
  });

  it("lists plan serve in the plan help", async () => {
    const r = await run(["help"]);
    expect(r.out).toContain("plan serve");
  });
});
