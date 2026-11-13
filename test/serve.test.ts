// nikos serve in a code repo: its story map, live on 127.0.0.1 and as one page. The live page saves with its
// token (the saves are in map-serve-save.test.ts), and a planning repo is sent to nikos plan serve.
import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyExample, rootOf } from "./helpers";
import { runServeCommand, startMapServer } from "../src/commands/serve";
import { initPlanRepo } from "../src/plan/repo";
import type { RunningServer } from "../src/planning/server";
import { hash } from "../src/planning/model";

let running: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(running.map((s) => s.close()));
  running = [];
  vi.restoreAllMocks();
});

async function start(root: string): Promise<RunningServer> {
  const srv = await startMapServer(root);
  running.push(srv);
  return srv;
}

/** Run nikos serve with these arguments, capturing what it prints. */
function serve(args: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => (out += a.join(" ") + "\n"));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => (err += a.join(" ") + "\n"));
  const code = runServeCommand(args) as number;
  vi.restoreAllMocks();
  return { code, out, err };
}

describe("nikos serve in a code repo", () => {
  it("with several maps and none picked, lists them, and each opens its own map", async () => {
    const root = rootOf(copyExample());
    const first = readFileSync(join(root, "maps", "ht", "storymap.yaml"), "utf8");
    mkdirSync(join(root, "maps", "pay"), { recursive: true });
    writeFileSync(join(root, "maps", "pay", "storymap.yaml"), first.replace(/^key: .*$/m, "key: PAY"));
    const srv = await start(root);
    const list = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
    expect(list).toContain('href="/?map=ht"');
    expect(list).toContain('href="/?map=pay"');
    const one = await (await fetch(`http://127.0.0.1:${srv.port}/?map=ht`)).text();
    expect(one).toContain("Story map");
    expect(one).not.toContain("No stories yet");
    // Each map links back to the list, even on a server started on one map.
    expect(one).toContain('<a class="back" href="/?map=">← All story maps</a>');
    expect(await (await fetch(`http://127.0.0.1:${srv.port}/?map=`)).text()).toContain('href="/?map=pay"');
    const picked = await startMapServer(root, { map: "pay" });
    running.push(picked);
    expect(await (await fetch(`http://127.0.0.1:${picked.port}/`)).text()).toContain("← All story maps");
    expect(await (await fetch(`http://127.0.0.1:${picked.port}/?map=`)).text()).toContain('href="/?map=ht"');
    const r = serve(["--dir", root, "--export", join(root, "x.html")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Say which one to save with --map");
    expect(serve(["--dir", root, "--map", "nope", "--export", join(root, "x.html")]).err).toContain("There's no story map called 'nope'");
  });

  it("shows the story map at / and has no other page", async () => {
    const srv = await start(rootOf(copyExample()));
    const page = await fetch(`http://127.0.0.1:${srv.port}/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Story map");
    expect(html).toContain('id="f-q"');
    expect(html).not.toContain("← Planning");
    // One map: there's no list to go back to.
    expect(html).not.toContain("All story maps");
    for (const path of ["/map", "/api/data", "/nikos-view.js", "/views/x"]) {
      expect((await fetch(`http://127.0.0.1:${srv.port}${path}`)).status, path).toBe(404);
    }
  });

  it("takes saves only with its token: a POST without it is refused, and the pending list needs it too", async () => {
    const root = rootOf(copyExample());
    const srv = await start(root);
    const base = `http://127.0.0.1:${srv.port}`;
    const headers = { host: `127.0.0.1:${srv.port}`, "content-type": "application/json" };
    const body = JSON.stringify({ op: "story.rename", target: { story: "HT-1" }, args: { title: "Add a task fast" }, expect: "0000000000000000" });
    expect((await fetch(`${base}/api/op`, { method: "POST", headers, body })).status).toBe(403);
    // With the token, the save is checked: a stale version is refused, and nothing is written.
    const stale = await fetch(`${base}/api/op`, { method: "POST", headers: { ...headers, "x-nikos-token": srv.token }, body });
    expect(stale.status).toBe(409);
    expect(readFileSync(join(root, "maps/ht/features/tasks/add-a-task.feature"), "utf8")).not.toContain("Add a task fast");
    // With the feature's current version, the same save goes through and is written.
    const current = hash(readFileSync(join(root, "maps/ht/features/tasks/add-a-task.feature"), "utf8"));
    const saved = await fetch(`${base}/api/op`, { method: "POST", headers: { ...headers, "x-nikos-token": srv.token }, body: JSON.stringify({ ...JSON.parse(body), expect: current }) });
    expect(saved.status).toBe(200);
    expect(readFileSync(join(root, "maps/ht/features/tasks/add-a-task.feature"), "utf8")).toContain("Feature: Add a task fast");
    expect((await fetch(`${base}/api/pending`, { headers: { "x-nikos-token": srv.token } })).status).toBe(200);
    expect((await fetch(`${base}/api/pending`)).status).toBe(403);
    // Only the save and the git buttons are POST routes: any other path is refused as a save.
    expect((await fetch(`${base}/`, { method: "POST", headers: { ...headers, "x-nikos-token": srv.token }, body: "{}" })).status).toBe(501);
  });

  it("answers only on its own address", async () => {
    const srv = await start(rootOf(copyExample()));
    const status = await new Promise<number>((ok, fail) => {
      const req = http.request({ host: "127.0.0.1", port: srv.port, path: "/", headers: { host: "evil.example" } }, (res) => ok(res.statusCode ?? 0));
      req.on("error", fail);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("exports the same map as one read-only page", () => {
    const root = rootOf(copyExample());
    const dir = mkdtempSync(join(tmpdir(), "nikos-serve-export-"));
    const out = join(dir, "map.html");
    const r = serve(["--dir", root, "--export", out]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Saved the story map as one page: ${out}`);
    const html = readFileSync(out, "utf8");
    expect(html).toContain("Story map");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("fetch(");
  });

  it("refuses a bare --export, which would otherwise start the live server", () => {
    const r = serve(["--dir", rootOf(copyExample()), "--export"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("--export needs a file name");
  });

  it("says how to set up when there's no story map", () => {
    const dir = mkdtempSync(join(tmpdir(), "nikos-serve-nomap-"));
    const r = serve(["--dir", dir]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("it has no story map (maps/)");
    expect(r.err).toContain("nikos start");
  });
});

describe("nikos serve in a planning repo", () => {
  it("is sent to nikos plan serve, and writes nothing", () => {
    const repo = mkdtempSync(join(tmpdir(), "nikos-serve-plan-"));
    initPlanRepo(repo, { name: "Acme", year: "2027" });
    const r = serve(["--dir", repo]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("This is a planning repo");
    expect(r.err).toContain("nikos plan serve");
  });

  it("refuses an old-kind plan with the one-line message", () => {
    const repo = mkdtempSync(join(tmpdir(), "nikos-serve-old-"));
    mkdirSync(join(repo, "planning"));
    writeFileSync(join(repo, "planning", "plan.yaml"), "name: Acme\nlevel: company\n");
    const r = serve(["--dir", repo]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("planning/plan.yaml, a plan of the old kind");
  });
});
