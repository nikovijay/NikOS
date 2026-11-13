// nikos serve's saves on a story map: an edit goes on a nikos branch named for the map, the pending list and the
// git buttons take only the files the saves wrote, and a push happens only on its click. Real git repos with a
// bare origin, as the plan dashboard's saves are tested.
import { request } from "node:http";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMapServer } from "../src/commands/serve";
import { saveBarScript } from "../src/lib/save-bar";
import { realRun, type Runner } from "../src/lib/git";
import { hash } from "../src/planning/model";
import type { RunningServer } from "../src/planning/server";
import { copyExample, edit, rootOf } from "./helpers";
import { bareOrigin, commitAll, git } from "./planning-fixture";

let open: RunningServer[] = [];
/** The temp repos a test makes, removed after it. */
const made: string[] = [];
afterEach(async () => {
  await Promise.all(open.map((s) => s.close()));
  open = [];
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const today = () => new Date().toISOString().slice(0, 10);
const FEATURE = "maps/ht/features/tasks/add-a-task.feature";

/** The example map in a git repo, its base branch main, pushed to a bare origin. change edits the map before its first commit. */
function gitMap(change?: (root: string) => void): string {
  const root = rootOf(copyExample());
  made.push(root);
  change?.(root);
  git(root, "init", "-q", "-b", "main");
  const origin = bareOrigin();
  made.push(origin);
  git(root, "remote", "add", "origin", origin);
  commitAll(root, "the story map");
  git(root, "push", "-q", "-u", "origin", "main");
  return root;
}

async function start(root: string, run?: Runner): Promise<RunningServer> {
  const srv = await startMapServer(root, { port: 0, run });
  open.push(srv);
  return srv;
}

function post(srv: RunningServer, path: string, body: unknown, token = srv.token): Promise<{ status: number; body: any }> {
  const payload = JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = request(
      { host: "127.0.0.1", port: srv.port, path, method: "POST", headers: { host: `127.0.0.1:${srv.port}`, "content-type": "application/json", "x-nikos-token": token, "content-length": Buffer.byteLength(payload) } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (text += c));
        res.on("end", () => ok({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {} }));
      },
    );
    req.on("error", fail);
    req.end(payload);
  });
}

async function pending(srv: RunningServer): Promise<any> {
  return fetch(`http://127.0.0.1:${srv.port}/api/pending`, { headers: { "x-nikos-token": srv.token } }).then((r) => r.json());
}

/** The version of a file a save must carry: its hash, as the page loads it. */
const versionOf = (root: string, rel: string) => hash(readFileSync(join(root, rel), "utf8"));

/** A runner that passes git through and records every call. */
function recorder(): { calls: string[][]; run: Runner } {
  const calls: string[][] = [];
  return { calls, run: (cmd, args, cwd) => (calls.push([cmd, ...args]), realRun(cmd, args, cwd)) };
}

const rename = (root: string, title: string) => ({ op: "story.rename", map: "ht", target: { story: "HT-1" }, args: { title }, expect: versionOf(root, FEATURE) });

describe("a save from the story map", () => {
  it("goes on a nikos branch named for the map, and writes the story's file", async () => {
    const root = gitMap();
    const srv = await start(root);
    const r = await post(srv, "/api/op", rename(root, "Add a task in one tap"));
    expect(r.status).toBe(200);
    expect(r.body.branch).toBe(`nikos/map-ht-${today()}`);
    expect(r.body.changed).toContain(FEATURE);
    expect(git(root, "branch", "--show-current")).toBe(`nikos/map-ht-${today()}`);
    expect(readFileSync(join(root, FEATURE), "utf8")).toContain("Feature: Add a task in one tap");
  });

  it("the pending list names only the files the saves wrote, and a commit takes only them", async () => {
    const root = gitMap();
    const srv = await start(root);
    writeFileSync(join(root, "notes.txt"), "a stray file\n");
    expect((await post(srv, "/api/op", rename(root, "Add a task in one tap"))).status).toBe(200);
    const list = await pending(srv);
    expect(list.paths).toContain(FEATURE);
    expect(list.paths.every((p: string) => p.startsWith("maps/ht/"))).toBe(true);
    expect(list.paths).not.toContain("notes.txt");
    const committed = await post(srv, "/api/git/commit", {});
    expect(committed.status).toBe(200);
    expect(git(root, "log", "-1", "--format=%s")).toBe("Update the ht story map");
    expect(git(root, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean)).not.toContain("notes.txt");
    expect(git(root, "status", "--porcelain")).toBe("?? notes.txt");
  });

  it("placing a story under another activity moves its file, and the commit takes the old file's removal", async () => {
    // A second activity, so the story has somewhere else to go.
    const root = gitMap((r) => edit(join(r, "maps/ht/storymap.yaml"), (s) => s.replace("releases:", "  - id: plan\n    title: Plan the day\nreleases:")));
    const srv = await start(root);
    const moved = "maps/ht/features/plan/add-a-task.feature";
    const r = await post(srv, "/api/op", { op: "story.place", map: "ht", target: { story: "HT-1" }, args: { activity: "plan", step: "" }, expect: versionOf(root, FEATURE) });
    expect(r.status).toBe(200);
    expect(r.body.changed).toEqual(expect.arrayContaining([FEATURE, moved]));
    expect(existsSync(join(root, FEATURE))).toBe(false);
    // The pending list names the old file (removed) and the new one (added), and no other file.
    const list = await pending(srv);
    expect(list.paths).toEqual(expect.arrayContaining([FEATURE, moved]));
    expect(list.paths.every((p: string) => p.startsWith("maps/ht/"))).toBe(true);
    expect((await post(srv, "/api/git/commit", {})).status).toBe(200);
    const shown = git(root, "show", "--name-status", "--no-renames", "--format=", "HEAD").split("\n").filter(Boolean);
    expect(shown).toContain(`D\t${FEATURE}`);
    expect(shown).toContain(`A\t${moved}`);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("never pushes on a save: only the Push button does", async () => {
    const root = gitMap();
    const rec = recorder();
    const srv = await start(root, rec.run);
    expect((await post(srv, "/api/op", rename(root, "Add a task in one tap"))).status).toBe(200);
    expect(rec.calls.some((c) => c.includes("push"))).toBe(false);
    await post(srv, "/api/git/commit", {});
    expect(rec.calls.some((c) => c.includes("push"))).toBe(false);
    const pushed = await post(srv, "/api/git/push", {});
    expect(pushed.status).toBe(200);
    expect(rec.calls.some((c) => c.includes("push"))).toBe(true);
    expect(git(root, "ls-remote", "--heads", "origin")).toContain(`refs/heads/nikos/map-ht-${today()}`);
  });

  it("a stale version is a 409 that changes nothing and makes no branch", async () => {
    const root = gitMap();
    const srv = await start(root);
    const r = await post(srv, "/api/op", { ...rename(root, "Add a task in one tap"), expect: "0000000000000000" });
    expect(r.status).toBe(409);
    expect(git(root, "branch", "--show-current")).toBe("main");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("refuses a change that isn't to a story map, and changes nothing", async () => {
    const root = gitMap();
    const srv = await start(root);
    const r = await post(srv, "/api/op", { op: "checkin", target: { kr: "close-days" }, args: { value: 8 }, expect: "x" });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("checkin isn't a change the story map makes");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("with several maps, a save names its map, and a map it doesn't name is refused", async () => {
    const root = rootOf(copyExample());
    made.push(root);
    cpSync(join(root, "maps", "ht"), join(root, "maps", "pay"), { recursive: true });
    writeFileSync(join(root, "maps", "pay", "storymap.yaml"), readFileSync(join(root, "maps", "pay", "storymap.yaml"), "utf8").replace(/^key: .*$/m, "key: PAY"));
    const srv = await start(root);
    const none = await post(srv, "/api/op", { op: "story.rename", target: { story: "HT-1" }, args: { title: "x" }, expect: versionOf(root, FEATURE) });
    expect(none.status).toBe(400);
    expect(none.body.error).toContain("pass --map");
    const both = await post(srv, "/api/op", { op: "story.rename", map: "ht", args: { title: "x", map: "pay" }, target: { story: "HT-1" }, expect: versionOf(root, FEATURE) });
    expect(both.status).toBe(400);
    expect(both.body.error).toContain("two story maps");
    const picked = await post(srv, "/api/op", { op: "story.rename", map: "ht", target: { story: "HT-1" }, args: { title: "Add a task in one tap" }, expect: versionOf(root, FEATURE) });
    expect(picked.status).toBe(200);
    expect(readFileSync(join(root, FEATURE), "utf8")).toContain("Feature: Add a task in one tap");
  });

  it("serves the page with its token, and a save with that token is taken", async () => {
    const root = gitMap();
    const srv = await start(root);
    const html = await fetch(`http://127.0.0.1:${srv.port}/`).then((r) => r.text());
    expect(html).toContain(`<meta name="nikos-token" content="${srv.token}">`);
    expect(html).toContain('data-op="story.edit"');
    // The page reads its token from that meta tag, and sends it with each save.
    const token = /name="nikos-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(token).toBe(srv.token);
    expect((await post(srv, "/api/op", rename(root, "Add a task in one tap"), token)).status).toBe(200);
  });

  it("with no token, a save is refused and nothing is written", async () => {
    const root = gitMap();
    const srv = await start(root);
    const r = await post(srv, "/api/op", rename(root, "Add a task in one tap"), "wrong");
    expect(r.status).toBe(403);
    expect(git(root, "status", "--porcelain")).toBe("");
  });
});

describe("the pending bar", () => {
  it("is one script for both pages: it parses, and names the command its server runs by", () => {
    const js = saveBarScript("nikos serve", "story map");
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain("Is nikos serve still running?");
    expect(saveBarScript("nikos plan serve", "dashboard")).toContain("Is nikos plan serve still running?");
    expect(saveBarScript("nikos serve", "story map")).toContain("Couldn't reach the story map. Is nikos serve still running?");
    expect(saveBarScript("nikos plan serve", "dashboard")).toContain("Couldn't reach the dashboard. Is nikos plan serve still running?");
  });
});
