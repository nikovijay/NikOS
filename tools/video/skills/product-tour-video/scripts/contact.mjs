// A contact sheet: renders tour.html at the given seconds, stamps each frame
// with its time, and tiles them into one image you can look at in one read.
//   node contact.mjs sheet.png 3 9 14.5 22 31 40
// Needs Playwright with Chromium. Reports page errors.
import { resolve } from "node:path";
import playwright from "playwright";

const [out = "sheet.png", ...times] = process.argv.slice(2);
if (!times.length) { console.error("usage: node contact.mjs sheet.png <seconds…>"); process.exit(1); }
const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(new URL("./tour.html", import.meta.url).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
const frames = [];
for (const t of times.map(Number)) {
  await page.evaluate((x) => window.renderAt(x), t);
  await page.evaluate((x) => {
    let s = document.getElementById("__contact_time");
    if (!s) s = document.body.appendChild(Object.assign(document.createElement("div"), { id: "__contact_time" }));
    Object.assign(s.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", padding: "6px 14px", font: "600 64px monospace", color: "red", background: "white" });
    s.textContent = `${x}s`;
  }, t);
  frames.push((await page.screenshot({ type: "jpeg", quality: 90 })).toString("base64"));
}
// Tile the frames in a page of their own and screenshot it. ffmpeg's tile filter
// keeps only the last frame on some builds, depending on how the inputs are timed.
const W = 640, H = 360, GAP = 6;
const cols = Math.min(4, frames.length), rows = Math.ceil(frames.length / cols);
const width = cols * W + (cols - 1) * GAP, height = rows * H + (rows - 1) * GAP;
const sheet = await browser.newPage({ viewport: { width, height } });
await sheet.setContent(
  `<body style="margin:0;background:white;display:grid;gap:${GAP}px;grid-template-columns:repeat(${cols},${W}px);grid-auto-rows:${H}px">` +
    frames.map((f) => `<img style="width:${W}px;height:${H}px;display:block" src="data:image/jpeg;base64,${f}">`).join("") +
    "</body>",
);
await sheet.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
await sheet.screenshot({ path: resolve(out) });
await browser.close();
console.log(errors.length ? `page errors: ${JSON.stringify(errors)}` : "page errors: none");
console.log(`wrote ${resolve(out)}`);
