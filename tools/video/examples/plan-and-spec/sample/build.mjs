// Builds the example the video shows, for real, and saves each page as the video needs it.
//   node sample/build.mjs <empty folder>
// It makes Acme's planning repo and the shop-web code repo with nikOS, adds the key result and the bet
// through the dashboard's own save API, builds and proves the checkout stories with Cucumber, and links the
// two. Each page is saved to screens/<name>.html and each command's real output to screens/terminal.json.
// Needs the nikOS repo built (npm run build) and its node_modules, which has Cucumber.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NIKOS = resolve(here, "../../../../..");
const CLI = join(NIKOS, "dist/cli.js");
const SCREENS = join(here, "../screens");
const out = resolve(process.argv[2] ?? "");
if (!process.argv[2] || (existsSync(out) && readdirSync(out).length)) throw new Error("Give an empty folder: node sample/build.mjs <folder>");
mkdirSync(SCREENS, { recursive: true });
const PLAN = join(out, "plan");
const SHOP = join(out, "shop");
const env = { ...process.env, NIKOS_NO_VERSION_CHECK: "1", GIT_ALLOW_PROTOCOL: "file", GIT_AUTHOR_DATE: "2026-11-16T09:00:00Z", GIT_COMMITTER_DATE: "2026-11-16T09:00:00Z" };
const terminal = {};

/** Run nikos in a folder. With `keep`, its output (and a refusal's) is saved for the video under that name. */
function nikos(cwd, args, keep) {
  try {
    const text = execFileSync("node", [CLI, ...args], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (keep) terminal[keep] = { command: `nikos ${args.join(" ")}`, output: text.trimEnd(), ok: true };
    return text;
  } catch (err) {
    if (!keep) throw new Error(`nikos ${args.join(" ")} failed in ${cwd}:\n${err.stdout}${err.stderr}`);
    terminal[keep] = { command: `nikos ${args.join(" ")}`, output: `${err.stdout ?? ""}${err.stderr ?? ""}`.trimEnd(), ok: false };
    return "";
  }
}
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
/** A git repo for the example, signed as Sam so nobody's own name is in the video. */
const repo = (cwd) => {
  mkdirSync(cwd, { recursive: true });
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.name", "Sam");
  git(cwd, "config", "user.email", "sam@acme");
};
const commit = (cwd, message) => {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", message);
};

/** Start a nikOS page server and return its base url and token. */
async function serve(cwd, args) {
  const child = spawn("node", [CLI, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((ok, fail) => {
    let text = "";
    child.stdout.on("data", (d) => {
      text += d;
      const m = /http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+/.exec(text);
      if (m) ok(m[0]);
    });
    child.on("exit", () => fail(new Error(`${args.join(" ")} stopped:\n${text}`)));
  });
  const u = new URL(url);
  return { child, base: u.origin, token: u.searchParams.get("token") };
}
async function page(srv, query, name) {
  const html = await (await fetch(`${srv.base}/?token=${srv.token}${query ? `&${query}` : ""}`)).text();
  // The server's token is no use once it stops, and has no place in a committed page.
  writeFileSync(join(SCREENS, `${name}.html`), html.replaceAll(srv.token, "example"));
}
async function op(srv, body) {
  const r = await fetch(`${srv.base}/api/op`, { method: "POST", headers: { "content-type": "application/json", "x-nikos-token": srv.token }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${body.op}: ${j.error}`);
  return j;
}

// ── The plan: Acme, its Commerce department and the Web team ─────────────
repo(PLAN);
// An origin to push to, so the dashboard offers Push as it would for a hosted repo.
git(out, "init", "-q", "--bare", "plan-origin.git");
git(PLAN, "remote", "add", "origin", join(out, "plan-origin.git"));
nikos(PLAN, ["plan", "init", "--name", "Acme", "--year", "2026"]);
nikos(PLAN, ["plan", "add", "department", "commerce", "--name", "Commerce", "--owner", "Priya"]);
nikos(PLAN, ["plan", "add", "team", "WEB", "--name", "Web", "--home", "commerce"]);
nikos(PLAN, ["plan", "kr", "new", "--in", "company", "--title", "Online revenue reaches £12m", "--owner", "Dana", "--baseline", "8", "--target", "12", "--unit", "£m", "--objective", "Grow online"]);
nikos(PLAN, ["plan", "checkin", "online-revenue-reaches-12m", "11.3", "--date", "2026-11-02"]);
commit(PLAN, "Acme's plan");

let plan = await serve(PLAN, ["plan", "serve", "--port", "0"]);
await page(plan, "at=company&view=okrs", "01-company");
await page(plan, "at=departments/commerce&view=okrs", "02-commerce-empty");
// The department's key result and the team's bet, made the way the dashboard's forms make them.
await op(plan, { op: "kr.new", area: "departments/commerce", target: {}, args: { title: "Checkout conversion reaches 3%", owner: "Priya", baseline: 2.1, target: 3, unit: "%", period: "2026-Q4", objective: "Make buying easy", aligns_to: ["online-revenue-reaches-12m"] }, expect: "" });
await page(plan, "at=departments/commerce&view=okrs", "03-commerce-kr");
await page(plan, "at=teams/WEB&view=bets", "04-web-empty");
await op(plan, { op: "bet.new", area: "teams/WEB", target: {}, args: { title: "One-page checkout", owner: "Sam", hypothesis: "We think a one-page checkout will lift conversion, because most people who leave do it between steps.", review_on: "2026-12-10", primary: "checkout-conversion-reaches-3" }, expect: "" });
await page(plan, "at=teams/WEB&view=bets", "05-web-bet");
await page(plan, "at=teams/WEB&view=ladder&widen=up", "06-ladder");
plan.child.kill();
// The dashboard saved on a branch: commit it there, and take it into main as a reviewer would.
const branch = git(PLAN, "branch", "--show-current").trim();
commit(PLAN, "A key result and a bet from the dashboard");
git(PLAN, "switch", "-q", "main");
git(PLAN, "merge", "-q", "--ff-only", branch);

// ── The code: shop-web's story map for the bet ─────────────────────────
repo(SHOP);
cpSync(join(here, "shop/package.json"), join(SHOP, "package.json"));
nikos(SHOP, ["map", "new", "--key", "CHK", "--bet", "one-page-checkout", "--owner", "WEB", "--name", "Checkout"]);
const storymap = join(SHOP, "maps/chk/storymap.yaml");
nikos(SHOP, ["activity", "add", "Pay for an order", "--id", "pay"]);
for (const step of ["Review the basket", "Enter delivery", "Pay"]) nikos(SHOP, ["step", "add", step, "--activity", "pay"]);
// map new starts with a getting-started activity and release 1: this map has its own.
writeFileSync(storymap, readFileSync(storymap, "utf8").replace(/  - id: getting-started\n    title: Getting started\n/, ""));
nikos(SHOP, ["release", "rename", "1", "One page", "--goal", "Buy in one page"]);
nikos(SHOP, ["release", "add", "Faster repeat buys", "--goal", "Returning buyers pay in one tap"]);
const STORIES = [
  ["See the whole basket on one page", "review-the-basket", 1, "must"],
  ["Change a quantity without leaving the page", "review-the-basket", 1, "should"],
  ["Enter a delivery address with lookup", "enter-delivery", 1, "must"],
  ["Pick a delivery slot", "enter-delivery", 1, "should"],
  ["Pay by card on the same page", "pay", 1, "must"],
  ["Show a clear error when a card is declined", "pay", 1, "must"],
  ["Save a card for next time", "pay", 2, "should"],
  ["Pay in one tap as a returning buyer", "pay", 2, "could"],
];
for (const [title, step, release, priority] of STORIES) nikos(SHOP, ["story", "add", title, "--activity", "pay", "--step", step, "--release", String(release), "--priority", priority]);
// The stories' acceptance criteria, written out in full.
cpSync(join(here, "shop/features"), join(SHOP, "maps/chk/features/pay"), { recursive: true });
cpSync(join(here, "shop/src"), join(SHOP, "src"), { recursive: true });
nikos(SHOP, ["verify", "setup"]);
cpSync(join(here, "shop/test"), join(SHOP, "test"), { recursive: true });
symlinkSync(join(NIKOS, "node_modules"), join(SHOP, "node_modules"));
writeFileSync(join(SHOP, ".gitignore"), "node_modules\n");
commit(SHOP, "The checkout story map, and the code so far");

// Three stories built and proved, one in progress, and the card payment's first try.
for (const id of ["WEB-CHK-1", "WEB-CHK-2", "WEB-CHK-3"]) {
  nikos(SHOP, ["state", "set", id, "in_progress", "--by", "agent"]);
  nikos(SHOP, ["state", "set", id, "done"]);
}
nikos(SHOP, ["state", "set", "WEB-CHK-4", "in_progress", "--by", "agent"]);
nikos(SHOP, ["state", "set", "WEB-CHK-5", "in_progress", "--by", "agent"]);
commit(SHOP, "Basket, quantities and address lookup are done");
let map = await serve(SHOP, ["serve", "--port", "0"]);
await page(map, "", "07-map");
map.child.kill();

// The done gate: the first try leaves out delivery, so WEB-CHK-5 can't be done until it's fixed.
nikos(SHOP, ["state", "set", "WEB-CHK-5", "done"], "refused");
writeFileSync(join(SHOP, "src/pay.mjs"), '// Paying by card.\nexport { payByCard } from "./checkout.mjs";\n');
commit(SHOP, "Charge delivery when paying by card");
nikos(SHOP, ["verify", "WEB-CHK-5"], "verify");
nikos(SHOP, ["state", "set", "WEB-CHK-5", "done"], "done");
// The commit the scenarios proved, as the agent quotes it when it asks for the sign-off.
terminal.commit = /WEB-CHK-5:[\s\S]*?tested_commit: ([0-9a-f]+)/.exec(readFileSync(join(SHOP, "maps/chk/state.yaml"), "utf8"))[1].slice(0, 7);
map = await serve(SHOP, ["serve", "--port", "0"]);
await page(map, "", "08-map-done");
map.child.kill();
nikos(SHOP, ["approve", "WEB-CHK-5", "--via", "chat"], "approve");
nikos(SHOP, ["map", "status"]);
commit(SHOP, "WEB-CHK-5 is done and approved");
map = await serve(SHOP, ["serve", "--port", "0"]);
await page(map, "", "08b-map-approved");
map.child.kill();

// ── Delivery back to the plan ────────────────────────────────────────────
writeFileSync(join(PLAN, "planning/repos.yaml"), `version: 1\nrepos:\n  - repo: acme/shop-web\n    url: ${SHOP}\n`);
commit(PLAN, "Read shop-web's delivery");
nikos(PLAN, ["plan", "refresh"]);
plan = await serve(PLAN, ["plan", "serve", "--port", "0"]);
await page(plan, "at=departments/commerce&view=okrs", "09-commerce-before");
// A check-in edits the key result's file, so it sends the version the page was drawn from, as the form does.
const version = /data-op="checkin"[^>]*data-expect="([0-9a-f]+)"/.exec(readFileSync(join(SCREENS, "09-commerce-before.html"), "utf8"))[1];
await op(plan, { op: "checkin", area: "departments/commerce", target: { kr: "checkout-conversion-reaches-3" }, args: { value: 2.6, date: "2026-11-16", note: "First week of the one-page checkout" }, expect: version });
await page(plan, "at=departments/commerce&view=okrs", "10-commerce-after");
const pending = await (await fetch(`${plan.base}/api/pending`, { headers: { "x-nikos-token": plan.token } })).json();
plan.child.kill();
writeFileSync(join(SCREENS, "terminal.json"), `${JSON.stringify({ ...terminal, pending }, null, 2)}\n`);
console.log(`Saved the pages to ${SCREENS}`);
