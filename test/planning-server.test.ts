import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { copyExample, edit } from "./helpers.js";
import { newBet } from "../src/planning/bets.js";
import { checkIn, newKr } from "../src/planning/krs.js";
import { hash, loadKr } from "../src/planning/model.js";
import { exportSnapshot, planningData, startServer, VIEW_CONTRACT } from "../src/planning/server.js";

type Running = Awaited<ReturnType<typeof startServer>>;
let running: Running[] = [];

afterEach(async () => {
  await Promise.all(running.map((s) => s.close()));
  running = [];
  vi.restoreAllMocks();
});

/** A temp repo with the hello-todo story map, one KR with a check-in, and one bet on release 1. */
function setup(): string {
  const root = dirname(copyExample());
  rmSync(join(root, "planning"), { recursive: true, force: true });
  edit(join(root, "intent", "storymap.yaml"), (s) => (s.includes("bets:") ? s : s.replace("stories: [HT-1, HT-2]", "bets: [fewer-missed-tasks]\n    stories: [HT-1, HT-2]")));
  newKr({ id: "missed-tasks", title: "Missed tasks", owner: "Ana", baseline: 12, target: 4, by: "2027-03-31", unit: "tasks" }, root);
  checkIn(root, "missed-tasks", { value: 9, date: "2026-11-01", note: "first week" });
  newBet(
    {
      id: "fewer-missed-tasks",
      owner: "Ana",
      team: "Core",
      hypothesis: "Reminders cut the tasks we miss",
      reviewOn: "2027-01-15",
      starts: "2026-11-01",
      primary: "missed-tasks",
    },
    root,
  );
  return root;
}

async function start(root: string): Promise<Running> {
  const srv = await startServer(root);
  running.push(srv);
  return srv;
}

const base = (srv: Running) => `http://127.0.0.1:${srv.port}`;

async function post(srv: Running, path: string, body: unknown, token: string | null = srv.token) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["x-nikos-token"] = token;
  const res = await fetch(base(srv) + path, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

async function getData(srv: Running): Promise<any> {
  return (await fetch(`${base(srv)}/api/data`)).json();
}

/** Hash of every file under dir, except the planning/ folder. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      const rel = relative(dir, p);
      if (rel === "planning") continue;
      if (statSync(p).isDirectory()) visit(p);
      else out[rel] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  visit(dir);
  return out;
}

describe("dashboard", () => {
  test("serves the views on 127.0.0.1", async () => {
    const srv = await start(setup());
    expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+$/);
    const page = await (await fetch(srv.url)).text();
    expect(page).toContain("Missed tasks");
    expect(page).toContain("fewer-missed-tasks");
    expect(page).toContain("Timeline");
    expect(page).toContain(srv.token);
    const data = await getData(srv);
    expect(data.krs[0]).toMatchObject({ id: "missed-tasks", latestValue: 9, stale: false });
    expect(data.bets[0]).toMatchObject({ id: "fewer-missed-tasks", team: "Core" });
  });

  test("refuses a save without the token", async () => {
    const root = setup();
    const srv = await start(root);
    const file = join(root, "planning", "krs", "missed-tasks.yaml");
    const before = readFileSync(file, "utf8");
    const res = await post(srv, "/api/checkin", { id: "missed-tasks", expect: hash(before), value: 3 }, null);
    expect(res.status).toBe(403);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("refuses a stale save", async () => {
    const root = setup();
    const srv = await start(root);
    const data = await getData(srv);
    const kr = data.krs[0];
    // Someone else checks in on disk after the page loaded.
    checkIn(root, "missed-tasks", { value: 8, date: "2026-11-02" });
    const res = await post(srv, "/api/checkin", { id: "missed-tasks", expect: kr.hash, value: 7 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed on disk/);
    expect(loadKr(root, "missed-tasks").data.checkins.map((c: any) => c.value)).toEqual([9, 8]);
  });

  test("a check-in writes only inside planning/", async () => {
    const root = setup();
    const srv = await start(root);
    const before = snapshot(root);
    const data = await getData(srv);
    const res = await post(srv, "/api/checkin", { id: "missed-tasks", expect: data.krs[0].hash, value: 7, note: "reminders on" });
    expect(res.status).toBe(200);
    expect(res.body.wrote.startsWith("planning/krs/")).toBe(true);
    expect(loadKr(root, "missed-tasks").data.checkins.at(-1)).toMatchObject({ value: 7, note: "reminders on" });
    expect(snapshot(root)).toEqual(before);
    expect(existsSync(join(root, ".git"))).toBe(false);
  });

  test("a bet links to its releases on the story map", async () => {
    const srv = await start(setup());
    const data = await getData(srv);
    expect(data.bets[0].releases).toEqual([{ number: 1, title: "MVP", href: "/map#release-1" }]);
    expect(await (await fetch(srv.url)).text()).toContain("/map#release-1");
    const map = await (await fetch(`${base(srv)}/map`)).text();
    expect(map).toContain('id="release-1"');
    expect(map).toContain('<div class="filters" role="search">');
  });

  test("a bet edit and a review save through the same checks", async () => {
    const root = setup();
    const srv = await start(root);
    const data = await getData(srv);
    const bet = data.bets[0];
    const edited = await post(srv, "/api/bet", { id: bet.id, expect: bet.hash, fields: { confidence: "high" } });
    expect(edited.status).toBe(200);
    const after = await getData(srv);
    const reviewed = await post(srv, "/api/review", { id: bet.id, expect: after.bets[0].hash, decision: "continue", reason: "On track" });
    expect(reviewed.status).toBe(200);
    expect((await post(srv, "/api/review", { id: bet.id, expect: bet.hash, decision: "continue", reason: "x" })).status).toBe(409);
    expect((await post(srv, "/api/checkin", { id: "../../etc", expect: "x", value: 1 })).status).toBe(400);
  });
});

describe("dashboard copy", () => {
  test("an upstream KR reads as aligned, and headings leave no blank line", async () => {
    const html = await (await fetch(`${base(await start(setup()))}/`)).text();
    expect(html).toContain("'Aligned to '");
    expect(html).not.toContain("Locked to");
    const fn = (name: string) => html.match(new RegExp(`function ${name}\\(text\\) \\{[\\s\\S]*?\\n\\}`))?.[0] ?? html.match(new RegExp(`function ${name}\\(s\\) \\{.*\\}`))?.[0];
    const prose = new Function(`${fn("esc")}\n${fn("prose")}\nreturn prose;`)();
    expect(prose("## Why we think so\n\nSeven of ten testers said so.\nAnd more.")).toBe("<h4>Why we think so</h4>Seven of ten testers said so.\nAnd more.");
  });

  test("a How it works page explains the levels and marks this plan's", async () => {
    const html = await (await fetch(`${base(await start(setup()))}/`)).text();
    expect(html).toContain('<a data-nav="guide" href="#/guide">How it works</a>');
    for (const text of ["'Company'", "'Department'", "'Group'", "'Team'", "What nikOS adds", "shipped is not won"]) expect(html).toContain(text);
    expect(html).toContain("l[0] === level ? chip('This plan', 'green')");
  });

  test("the sidebar ends with one quiet link to Niko's site", async () => {
    const html = await (await fetch(`${base(await start(setup()))}/`)).text();
    const links = html.match(/<div class="links">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(links.match(/<a /g)).toHaveLength(1);
    expect(links).toContain('href="https://www.nikovijay.com/connect?from=nikos-planning"');
    expect(html.indexOf('<div class="links">')).toBeLessThan(html.indexOf("</aside>"));
  });
});

describe("custom views", () => {
  test("a view in planning/views is served with the contract script", async () => {
    const root = setup();
    mkdirSync(join(root, "planning", "views"), { recursive: true });
    writeFileSync(join(root, "planning", "views", "at-risk.html"), "<!doctype html><html><head><title>At risk</title></head><body>At risk</body></html>");
    const srv = await start(root);
    const res = await fetch(`${base(srv)}/views/at-risk`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('src="/nikos-view.js"');
    expect(html).toContain(`<meta name="nikos-token" content="${srv.token}">`);
    const js = await (await fetch(`${base(srv)}/nikos-view.js`)).text();
    expect(js).toContain("window.nikos");
    for (const bad of ["/views/../x", "/views/..%2Fx", "/views/Bad_Name", "/views/missing", "/views/at-risk.html"]) {
      expect((await fetch(base(srv) + bad)).status).toBe(404);
    }
    expect(VIEW_CONTRACT).toContain("nikos.save");
  });

  test("a custom view's save uses the token and hash checks", async () => {
    const root = setup();
    const srv = await start(root);
    const js = await (await fetch(`${base(srv)}/nikos-view.js`)).text();
    expect(js).toContain("X-Nikos-Token");
    for (const endpoint of ["/api/checkin", "/api/bet", "/api/review"]) expect(js).toContain(endpoint);
    expect((await post(srv, "/api/checkin", { id: "missed-tasks", expect: "x", value: 1 }, null)).status).toBe(403);
    const data = await getData(srv);
    const ok = await post(srv, "/api/checkin", { id: "missed-tasks", expect: data.krs[0].hash, value: 6 }, srv.token);
    expect(ok.status).toBe(200);
  });
});

describe("export", () => {
  test("writes one read-only file", async () => {
    const root = setup();
    const dir = mkdtempSync(join(tmpdir(), "nikos-export-"));
    const out = join(dir, "dashboard.html");
    const res = exportSnapshot(root, out);
    expect(res).toEqual({ wrote: out, warned: false });
    expect(readdirSync(dir)).toEqual(["dashboard.html"]);
    const html = readFileSync(out, "utf8");
    expect(html).toContain("Missed tasks");
    expect(html).toContain("fewer-missed-tasks");
    expect(html).not.toContain("fetch(");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("X-Nikos-Token");
    expect(html).not.toMatch(/(src|href)=["']https?:\/\//i);
    expect(html).not.toContain("<script src");
  });

  test("warns when upstream content is included", async () => {
    const root = setup();
    const upstream = join(root, ".nikos", "upstream", "acme", "company-plan");
    newKr({ id: "kr-2", title: "Grow revenue", owner: "Board", baseline: 1, target: 2, by: "2027-06-30" }, upstream);
    newKr({ id: "aligned", title: "Aligned KR", owner: "Ana", baseline: 0, target: 1, by: "2027-06-30", alignsTo: "acme/company-plan#kr-2" }, root);

    const aligned = planningData(root).krs.find((k) => k.id === "aligned");
    expect(aligned?.upstream).toMatchObject({ repo: "acme/company-plan", found: true, readOnly: true });

    const dir = mkdtempSync(join(tmpdir(), "nikos-export-"));
    const out = join(dir, "dashboard.html");
    const writes: string[] = [];
    const existedAtWarning: boolean[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
      const text = String(chunk);
      writes.push(text);
      if (text.includes("This snapshot includes plans from other repos")) existedAtWarning.push(existsSync(out));
      return true;
    });
    const res = exportSnapshot(root, out);
    expect(res.warned).toBe(true);
    expect(writes.join("")).toContain("acme/company-plan");
    expect(existedAtWarning).toEqual([false]);
    expect(existsSync(out)).toBe(true);
  });
});
