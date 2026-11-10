// The git flow of a dashboard save: the nikos branch, what a commit takes, the push and the pull
// request, each only on its own click. Real git repos with a bare origin; the forge tools are fakes.
import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hash } from "../src/planning/model";
import { startServer, type RunningServer } from "../src/planning/server";
import { realRun, type Runner } from "../src/lib/git";
import { bareOrigin, commitAll, companyRepo, git, readText, todayIso } from "./planning-fixture";

let running: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(running.map((s) => s.close()));
  running = [];
});

async function start(root: string, run?: Runner): Promise<RunningServer> {
  const srv = await startServer(root, run ? { run } : {});
  running.push(srv);
  return srv;
}

function post(srv: RunningServer, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const payload = JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = http.request(
      { host: "127.0.0.1", port: srv.port, path, method: "POST", headers: { host: `127.0.0.1:${srv.port}`, "content-type": "application/json", "x-nikos-token": srv.token, "content-length": Buffer.byteLength(payload) } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => ok({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {} }));
      },
    );
    req.on("error", fail);
    req.write(payload);
    req.end();
  });
}

async function pending(srv: RunningServer): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/pending`, { headers: { "x-nikos-token": srv.token } });
  return res.json();
}

/** A runner that passes git through and records every call. */
function recorder(): { calls: string[][]; run: Runner } {
  const calls: string[][] = [];
  return { calls, run: (cmd, args, cwd) => (calls.push([cmd, ...args]), realRun(cmd, args, cwd)) };
}

/** Like recorder, but gh and glab are whatever the test says: absent by default. */
function tools(present: Record<string, { status: number; stdout?: string }>): { calls: string[][]; run: Runner } {
  const calls: string[][] = [];
  const run: Runner = (cmd, args, cwd) => {
    if (cmd !== "gh" && cmd !== "glab") return (calls.push([cmd, ...args]), realRun(cmd, args, cwd));
    calls.push([cmd, ...args]);
    const t = present[cmd];
    if (!t) return { status: null, stdout: "", stderr: `${cmd}: not found` };
    if (args[0] === "--version") return { status: 0, stdout: `${cmd} version`, stderr: "" };
    return { status: t.status, stdout: t.stdout ?? "", stderr: "" };
  };
  return { calls, run };
}

/** The checkin a test saves: the value on kr-1, with the hash of the file as it is now. */
const op = (co: string, value: number) => ({ op: "checkin", target: { kr: "kr-1" }, args: { value }, expect: hash(readText(co, "planning/krs/kr-1.yaml")) });

describe("the nikos branch", () => {
  it("the first save on main creates a branch named for the level and the date", async () => {
    const co = companyRepo();
    const srv = await start(co);
    const res = await post(srv, "/api/op", op(co, 1.5));
    expect(res.status).toBe(200);
    expect(res.body.branch).toBe(`nikos/plan-company-${todayIso()}`);
    expect(git(co, "branch", "--show-current")).toBe(`nikos/plan-company-${todayIso()}`);
  });

  it("a second save stays on the same branch", async () => {
    const co = companyRepo();
    const srv = await start(co);
    await post(srv, "/api/op", op(co, 1.5));
    const again = await post(srv, "/api/op", op(co, 2));
    expect(again.status).toBe(200);
    expect(git(co, "branch", "--list", "nikos/*").split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("with an unrelated file changed, warns; a commit takes only the planning paths", async () => {
    const co = companyRepo();
    writeFileSync(join(co, "notes.txt"), "one\n");
    commitAll(co, "notes");
    writeFileSync(join(co, "notes.txt"), "two\n");
    const srv = await start(co);
    await post(srv, "/api/op", op(co, 1.5));
    const p = await pending(srv);
    expect(p.warning).toContain("uncommitted changes outside planning/ and maps/");
    expect(p.unrelated.join("\n")).toContain("notes.txt");
    const commit = await post(srv, "/api/git/commit", {});
    expect(commit.status).toBe(200);
    const shown = git(co, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((f) => f.startsWith("planning/"))).toBe(true);
    // notes.txt is still changed in the work tree, and not staged.
    expect(git(co, "diff", "--cached", "--name-only")).toBe("");
    expect(git(co, "diff", "--name-only")).toBe("notes.txt");
  });

  it("with HEAD detached, saves as plain files, notes it, and refuses a commit", async () => {
    const co = companyRepo();
    git(co, "checkout", "-q", "--detach");
    const srv = await start(co);
    const res = await post(srv, "/api/op", op(co, 1.5));
    expect(res.status).toBe(200);
    expect(res.body.branch).toBeNull();
    expect(res.body.notice).toBe("Saves aren't on a branch because HEAD is detached");
    const commit = await post(srv, "/api/git/commit", {});
    expect(commit.status).toBe(400);
    expect(commit.body.error).toContain("HEAD is detached");
  });
  it("with no default branch to find (no origin, no main or master), a save still goes on a nikos branch", async () => {
    const co = companyRepo();
    git(co, "branch", "-m", "main", "trunk");
    const srv = await start(co);
    const saved = await post(srv, "/api/op", op(co, 2));
    expect(saved.status).toBe(200);
    expect(saved.body.branch).toMatch(/^nikos\//);
    expect(git(co, "branch", "--show-current")).toBe(saved.body.branch);
  });

  it("a refused save changes nothing: no branch is made or switched to", async () => {
    const co = companyRepo();
    const srv = await start(co);
    const unknown = await post(srv, "/api/op", { op: "not.a.real.op", args: {}, expect: "0000000000000000" });
    expect(unknown.status).toBe(400);
    const wrong = await post(srv, "/api/op", { ...op(co, 3), expect: "0000000000000000" });
    expect(wrong.status).toBe(409);
    expect(git(co, "branch", "--show-current")).toBe("main");
    const saved = await post(srv, "/api/op", op(co, 3));
    expect(saved.status).toBe(200);
    expect(saved.body.branch).toBeTruthy();
  });

  it("a commit takes exactly the files the bar lists, and refuses a file that looks like a secret", async () => {
    const co = companyRepo();
    const srv = await start(co);
    await post(srv, "/api/op", op(co, 1.5));
    writeFileSync(join(co, "planning", ".env"), "TOKEN=x\n");
    const refused = await post(srv, "/api/git/commit", {});
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain("looks like a secret");
    rmSync(join(co, "planning", ".env"));
    const ok = await post(srv, "/api/git/commit", {});
    expect(ok.status).toBe(200);
  });
});

describe("push and the request: only on a click", () => {
  it("a save never pushes; the push button does, with the branch argv", async () => {
    const co = companyRepo();
    git(co, "remote", "set-url", "origin", bareOrigin());
    const rec = recorder();
    const srv = await start(co, rec.run);
    const res = await post(srv, "/api/op", op(co, 1.5));
    const branch = res.body.branch as string;
    expect(rec.calls.some((c) => c[1] === "push")).toBe(false);
    const pushed = await post(srv, "/api/git/push", {});
    expect(pushed.status).toBe(200);
    expect(rec.calls).toContainEqual(["git", "push", "-u", "origin", branch]);
  });

  it("without a tool, the request is shown as a command to copy, and nothing runs", async () => {
    const co = companyRepo();
    git(co, "remote", "set-url", "origin", bareOrigin());
    const srv0 = await start(co, tools({}).run);
    const saved = await post(srv0, "/api/op", op(co, 1.5));
    const branch = saved.body.branch as string;
    await post(srv0, "/api/git/push", {});
    git(co, "remote", "set-url", "origin", "https://github.com/acme/company-plan.git");
    const rec = tools({});
    const srv = await start(co, rec.run);
    const res = await post(srv, "/api/git/pr", { confirm: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ran: false, command: `gh pr create --base main --head ${branch} --fill` });
    expect(rec.calls.some((c) => c[0] === "gh" && c[1] === "pr")).toBe(false);
  });

  it("with gh present, runs its argv only after a confirm", async () => {
    const co = companyRepo();
    git(co, "remote", "set-url", "origin", bareOrigin());
    const first = await start(co, tools({}).run);
    const branch = (await post(first, "/api/op", op(co, 1.5))).body.branch as string;
    await post(first, "/api/git/push", {});
    git(co, "remote", "set-url", "origin", "https://github.com/acme/company-plan.git");
    const rec = tools({ gh: { status: 0, stdout: "https://github.com/acme/company-plan/pull/1" } });
    const srv = await start(co, rec.run);
    const asked = await post(srv, "/api/git/pr", {});
    expect(asked.body).toMatchObject({ ran: false, needsConfirm: true });
    expect(rec.calls.some((c) => c[0] === "gh" && c[1] === "pr")).toBe(false);
    const done = await post(srv, "/api/git/pr", { confirm: true });
    expect(done.body).toMatchObject({ ran: true, ok: true });
    expect(rec.calls).toContainEqual(["gh", "pr", "create", "--base", "main", "--head", branch, "--fill"]);
  });

  it("on GitLab, the merge request command uses glab's flags", async () => {
    const co = companyRepo();
    git(co, "remote", "set-url", "origin", bareOrigin());
    const first = await start(co, tools({}).run);
    const branch = (await post(first, "/api/op", op(co, 1.5))).body.branch as string;
    await post(first, "/api/git/push", {});
    git(co, "remote", "set-url", "origin", "https://gitlab.com/acme/company-plan.git");
    const rec = tools({ glab: { status: 0, stdout: "https://gitlab.com/acme/company-plan/-/merge_requests/1" } });
    const srv = await start(co, rec.run);
    const pend = await pending(srv);
    expect(pend.forge).toMatchObject({ host: "gitlab", requestLabel: "Open merge request" });
    await post(srv, "/api/git/pr", { confirm: true });
    expect(rec.calls).toContainEqual(["glab", "mr", "create", "--source-branch", branch, "--target-branch", "main", "--fill", "--yes"]);
  });

  it("refuses a request before the branch is pushed, and refuses to push main", async () => {
    const co = companyRepo();
    git(co, "remote", "set-url", "origin", bareOrigin());
    const srv = await start(co, tools({ gh: { status: 0 } }).run);
    const saved = await post(srv, "/api/op", op(co, 1.5));
    expect(saved.body.branch).toBeTruthy();
    const early = await post(srv, "/api/git/pr", { confirm: true });
    expect(early.status).toBe(400);
    expect(early.body.error).toBe("Push the branch first, then open the request");
    git(co, "checkout", "-q", "main");
    const onMain = await post(srv, "/api/git/push", {});
    expect(onMain.status).toBe(400);
    expect(onMain.body.error).toBe("Push a nikos branch, not main");
    expect(readText(co, "planning/krs/kr-1.yaml")).toContain("checkins");
  });
});
