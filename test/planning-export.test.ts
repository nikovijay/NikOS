// The editable snapshot: one offline file that queues changes, with the flags, the embedded data
// and the checks the page runs. The plain --export is covered in planning-server.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlanning, parseArgs } from "../src/planning/cli";
import { exportEditable, planningData } from "../src/planning/server";
import { companyInit } from "../src/commands/start";
import { newKr } from "../src/planning/krs";
import { departmentRepo, companyRepo, git, groupRepo, write } from "./planning-fixture";

afterEach(() => vi.restoreAllMocks());

/** The data the page embeds, parsed back out of the file. */
function embedded(html: string): any {
  const m = html.match(/<script type="application\/json" id="nikos-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no embedded data");
  return JSON.parse(m[1]);
}

function spies() {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
  return { logs, errors };
}

const outFile = () => join(mkdtempSync(join(tmpdir(), "nikos-snap-")), "plan.html");

describe("the flags", () => {
  it("--editable and --with-linked take no value, in either order", () => {
    expect(parseArgs(["--editable", "--export", "plan.html"], ["editable", "with-linked"]).has("editable")).toBe(true);
    const a = parseArgs(["--export", "plan.html", "--editable", "--with-linked"], ["editable", "with-linked"]);
    expect(a.opt("export")).toBe("plan.html");
    expect(a.has("with-linked")).toBe(true);
    const b = parseArgs(["--editable", "--export", "x.html"], ["editable", "with-linked"]);
    expect(b.opt("export")).toBe("x.html");
    expect(b.positional).toEqual([]);
  });

  it("--editable without --export is an error", async () => {
    const co = companyRepo();
    const { errors } = spies();
    expect(await runPlanning(["serve", "--editable", "--dir", co])).toBe(1);
    expect(errors.join("\n")).toContain("--editable needs --export FILE");
  });

  it("--with-linked without --editable is an error", async () => {
    const co = companyRepo();
    const { errors } = spies();
    expect(await runPlanning(["serve", "--with-linked", "--export", outFile(), "--dir", co])).toBe(1);
    expect(errors.join("\n")).toContain("--with-linked needs --editable");
  });

  it("writes the file in every flag order", async () => {
    const co = companyRepo();
    spies();
    const a = outFile();
    const b = outFile();
    const c = outFile();
    expect(await runPlanning(["serve", "--editable", "--with-linked", "--export", a, "--dir", co])).toBe(0);
    expect(await runPlanning(["serve", "--export", b, "--editable", "--dir", co])).toBe(0);
    expect(await runPlanning(["serve", "--editable", "--export", c, "--dir", co])).toBe(0);
    for (const file of [a, b, c]) expect(existsSync(file)).toBe(true);
  });
});

describe("the editable file", () => {
  it("works offline: no fetch, no forms that post, no outside links, no token", async () => {
    const co = companyRepo();
    const file = outFile();
    spies();
    expect(await runPlanning(["serve", "--editable", "--export", file, "--dir", co])).toBe(0);
    const html = readFileSync(file, "utf8");
    for (const bad of ["fetch(", "XMLHttpRequest", "<form", "X-Nikos-Token", "<script src", "navigator.sendBeacon"]) expect(html).not.toContain(bad);
    expect(html).not.toMatch(/(src|href|action)=["']https?:\/\//i);
    expect(html).toContain("Snapshot, editable");
    expect(html).toContain("-changes-");
    expect(html).toContain(".nikos.json");
  });

  it("embeds the rules the page checks fields with, from the same source", async () => {
    const co = companyRepo();
    const file = outFile();
    spies();
    await runPlanning(["serve", "--editable", "--export", file, "--dir", co]);
    const html = readFileSync(file, "utf8");
    expect(html).toContain("function idProblem(kind, id)");
    expect(html).toContain("function krFieldProblems(fields, mode)");
    expect(html).toContain("Checked here: field rules only");
  });

  it("by default embeds only this level's own files: no upstream or downstream keys", async () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    const file = outFile();
    spies();
    expect(await runPlanning(["serve", "--editable", "--export", file, "--dir", dept])).toBe(0);
    const data = embedded(readFileSync(file, "utf8"));
    expect(data).not.toHaveProperty("upstream");
    expect(data).not.toHaveProperty("downstream");
    expect(data.snapshot).toMatchObject({ editable: true, withLinked: false });
    expect(JSON.stringify(data)).not.toContain("Grow revenue");
  });

  it("with --with-linked embeds the copies of the plan above, read-only, and says how many", async () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    const file = outFile();
    const { logs } = spies();
    expect(await runPlanning(["serve", "--editable", "--with-linked", "--export", file, "--dir", dept])).toBe(0);
    expect(logs.join("\n")).toContain("This file includes read-only copies of 1 other plans.");
    const data = embedded(readFileSync(file, "utf8"));
    expect(data.upstream.map((u: any) => u.repo)).toEqual(["acme/company-plan"]);
    expect(data.snapshot.withLinked).toBe(true);
  });

  it("refuses --with-linked when a plan above was never synced, with the sync message", async () => {
    const co = companyRepo();
    const dept = mkdtempSync(join(tmpdir(), "nikos-dept-"));
    companyInit(dept, { name: "Payments", period: "Q1 2027", repo: "acme/payments-plan", level: "department" });
    write(join(dept, "planning/upstream.yaml"), `- repo: acme/company-plan\n  url: ${co}\n`);
    const { errors } = spies();
    expect(await runPlanning(["serve", "--editable", "--with-linked", "--export", outFile(), "--dir", dept])).toBe(1);
    expect(errors.join("\n")).toContain("No synced copy of acme/company-plan: run nikos planning sync first, or leave out --with-linked");
  });

  it("records the commit it was made from, and the warning when there is no git repo", async () => {
    const co = companyRepo();
    spies();
    const file = outFile();
    await runPlanning(["serve", "--editable", "--export", file, "--dir", co]);
    expect(embedded(readFileSync(file, "utf8")).snapshot.source.commit).toBe(git(co, "rev-parse", "HEAD"));

    const plain = mkdtempSync(join(tmpdir(), "nikos-plain-"));
    companyInit(plain, { name: "Acme", period: "Q1 2027", repo: "acme/company-plan" });
    newKr({ id: "kr-1", title: "Grow revenue", owner: "Board", baseline: 1, target: 2, by: "2027-03-31" }, plain);
    const { logs } = spies();
    const out2 = outFile();
    await runPlanning(["serve", "--editable", "--export", out2, "--dir", plain]);
    expect(logs.join("\n")).toContain("! Not a git repo: the snapshot records no commit.");
    expect(embedded(readFileSync(out2, "utf8")).snapshot.source.commit).toBeNull();
  });

  it("leaves the team status out of the data, and keeps the story map's parts and stories", () => {
    const root = groupRepo("PAY");
    const data = planningData(root, undefined, { ownOnly: true, teamStatus: false });
    expect(data.maps.length).toBe(1);
    const stories = data.maps[0].stories;
    expect(stories.length).toBeGreaterThan(0);
    for (const s of stories) {
      expect(s.status).toBe("not in this snapshot");
      expect(s.fetched).toBeNull();
    }
    expect(data.teamIndex.fetched).toBeNull();
    expect(data).not.toHaveProperty("upstream");
  });

  it("the plain --export still writes the read-only file, with upstream content", async () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    const file = outFile();
    spies();
    expect(await runPlanning(["serve", "--export", file, "--dir", dept])).toBe(0);
    const html = readFileSync(file, "utf8");
    expect(html).toContain("Snapshot, read only");
    expect(html).not.toContain("nikos-changes");
    expect(embedded(html)).toHaveProperty("upstream");
    expect(html).not.toContain("function idProblem(");
  });

  it("the page's script parses, with the shared rules in it", async () => {
    const co = companyRepo();
    const file = outFile();
    spies();
    await runPlanning(["serve", "--editable", "--export", file, "--dir", co]);
    const html = readFileSync(file, "utf8");
    const scripts = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBe(1);
    // Parsed, not run: a syntax error in the page would stop every view.
    expect(() => new Function(scripts[0])).not.toThrow();
    expect(scripts[0]).not.toMatch(/fetch\(|XMLHttpRequest|X-Nikos-Token/);
  });

  it("the export function reports the copies it embedded", () => {
    const co = companyRepo();
    const dept = departmentRepo(co);
    const r = exportEditable(dept, outFile(), { withLinked: true });
    expect(r).toMatchObject({ withLinked: true, copies: 1 });
  });
});
