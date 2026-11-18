// Lays the voiceover (vo/s1.mp3 … at the offsets tour.html publishes as window.VO) over
// music/music.wav, ducking the music under the voice, and writes final.mp4 from video.mp4.
//   node voice.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import playwright from "playwright";

const f = (p) => fileURLToPath(new URL(p, import.meta.url));
const browser = await playwright.chromium.launch();
const page = await browser.newPage();
await page.goto(new URL("./tour.html", import.meta.url).href);
const VO = await page.evaluate(() => window.VO);
await browser.close();

const inputs = ["-i", f("./video.mp4"), "-i", f("./music/music.wav"), ...VO.flatMap(([file]) => ["-i", f(`./${file}`)])];
const delayed = VO.map(([, at], i) => `[${i + 2}:a]aresample=44100,pan=stereo|c0=c0|c1=c0,adelay=${Math.round(at * 1000)}:all=1[v${i}]`);
const filter = [
  ...delayed,
  `${VO.map((_, i) => `[v${i}]`).join("")}amix=inputs=${VO.length}:normalize=0,volume=1.6[vo]`,
  "[vo]apad,asplit[vo1][vo2]",
  "[1:a]volume=0.55[mu]",
  "[mu][vo1]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=450[duck]",
  "[duck][vo2]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11[a]",
].join(";");
const r = spawnSync("ffmpeg", ["-y", ...inputs, "-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", f("./final.mp4")], { stdio: ["ignore", "ignore", "inherit"] });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`wrote ${f("./final.mp4")}`);
