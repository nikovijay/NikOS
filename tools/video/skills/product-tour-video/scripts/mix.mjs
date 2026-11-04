// Lays music/music.wav (from music.mjs) under video.mp4 (from render.mjs) and writes final.mp4.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const f = (p) => fileURLToPath(new URL(p, import.meta.url));
const r = spawnSync(
  "ffmpeg",
  ["-y", "-i", f("./video.mp4"), "-i", f("./music/music.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", f("./final.mp4")],
  { stdio: "inherit" },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`wrote ${f("./final.mp4")}`);
