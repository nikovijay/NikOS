// A contact sheet: renders tour.html at the given seconds, stamps each frame
// with its time, and tiles them into one image you can look at in one read.
//   node contact.mjs sheet.png 3 9 14.5 22 31 40
// Needs Playwright with Chromium, and ffmpeg on PATH. Reports page errors.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import playwright from "playwright";

const [out = "sheet.png", ...times] = process.argv.slice(2);
if (!times.length) { console.error("usage: node contact.mjs sheet.png <seconds…>"); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), "contact-"));
const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(new URL("./tour.html", import.meta.url).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
const frames = [];
for (const [i, t] of times.map(Number).entries()) {
  await page.evaluate((x) => window.renderAt(x), t);
  // Stamp the time in the page, not with ffmpeg's drawtext, which many ffmpeg builds leave out.
  await page.evaluate((x) => {
    let s = document.getElementById("__contact_time");
    if (!s) s = document.body.appendChild(Object.assign(document.createElement("div"), { id: "__contact_time" }));
    Object.assign(s.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", padding: "6px 14px", font: "600 64px monospace", color: "red", background: "white" });
    s.textContent = `${x}s`;
  }, t);
  const raw = join(dir, `raw_${i}.png`), lab = join(dir, `lab_${String(i).padStart(3, "0")}.png`);
  await page.screenshot({ path: raw });
  const r = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", raw, "-vf", "scale=640:-1", lab], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  frames.push(lab);
}
await browser.close();
const cols = Math.min(4, frames.length), rows = Math.ceil(frames.length / cols);
const list = join(dir, "list.txt");
writeFileSync(list, frames.map((f) => `file '${f}'`).join("\n"));
const r = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", `tile=${cols}x${rows}:padding=6:color=white`, "-frames:v", "1", resolve(out)], { stdio: "inherit" });
rmSync(dir, { recursive: true, force: true });
console.log(errors.length ? `page errors: ${JSON.stringify(errors)}` : "page errors: none");
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`wrote ${resolve(out)}`);
