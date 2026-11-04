// Renders tour.html to video.mp4 (silent, 1920×1080, 25fps), or stills:
//   node render.mjs                  → video.mp4, the whole tour
//   node render.mjs range 0 15       → video.mp4, just 0–15s (style tests)
//   node render.mjs stills 2 8 14    → still_<t>.jpg at those seconds
// Needs Playwright with Chromium, and ffmpeg on PATH (see the skill's Commands section).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import playwright from "playwright";

const { chromium } = playwright;
const FPS = 25;
const [mode = "full", ...args] = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(new URL("./tour.html", import.meta.url).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1000);
const total = await page.evaluate(() => window.TOTAL);

if (mode === "stills") {
  for (const t of args.map(Number)) {
    await page.evaluate((x) => window.renderAt(x), t);
    await page.screenshot({ path: `still_${t}.jpg`, type: "jpeg", quality: 85 });
  }
} else {
  const [from, to] = mode === "range" ? args.map(Number) : [0, total];
  const out = fileURLToPath(new URL("./video.mp4", import.meta.url));
  const ff = spawn(
    "ffmpeg",
    ["-y", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", out],
    { stdio: ["pipe", "ignore", "inherit"] },
  );
  const frames = Math.ceil((to - from) * FPS);
  for (let f = 0; f < frames; f++) {
    await page.evaluate((x) => window.renderAt(x), from + f / FPS);
    const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 250 === 0) console.log(`frame ${f} / ${frames}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`wrote ${out}`);
}
await browser.close();
