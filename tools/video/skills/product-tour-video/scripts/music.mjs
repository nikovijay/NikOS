// Composes the tour's soundtrack in code, so it is ours outright: no licence,
// no stock track. Writes music/music.wav (stereo, 44.1 kHz), timed to tour.html:
// it reads the tour's length, clicks and beat changes from the page itself.
//   node music.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import playwright from "playwright";

const { chromium } = playwright;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(new URL("./tour.html", import.meta.url).href);
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => window.renderAt(0));
const { TOTAL, CLICKS = [], LABELS = [], END, CUES } = await page.evaluate(() => ({ TOTAL: window.TOTAL, CLICKS: window.CLICK_TIMES, LABELS: window.LABEL_TIMES, END: window.END_AT, CUES: window.MUSIC }));
await browser.close();
// Pages that don't publish window.MUSIC get a sensible default: drums from the second beat to the close.
const END_ = END ?? TOTAL - 6;
const CUES_ = CUES ?? { arpIn: 1.0, bassIn: 3.0, drums: [[LABELS?.[1] ?? 8, END_ - 0.2]], end: END_ };

const SR = 44100;
const N = Math.ceil(TOTAL * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const sendL = new Float32Array(N), sendR = new Float32Array(N);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const BEAT = 60 / 96;

// Five-second blocks of I–vi–IV–V in D, a dominant held into the close,
// resolving to D exactly as the cyanotype end card opens.
const CH = {
  D: [50, 54, 57, 61, 64], Bm: [47, 50, 54, 57, 61], G: [43, 47, 50, 54, 57], A: [45, 52, 57, 59, 61],
};
const SCHEDULE = [];
const ORDER = ["D", "Bm", "G", "A"];
let k = 0;
for (; (k + 1) * 5 <= END_ - 5; k++) SCHEDULE.push([k * 5, ORDER[k % 4]]);
SCHEDULE.push([k * 5, "A"], [END_, "D"]);
const chordAt = (t) => { let c = SCHEDULE[0][1]; for (const [s, n] of SCHEDULE) if (t >= s) c = n; return c; };
const chordEnd = (i) => (i + 1 < SCHEDULE.length ? SCHEDULE[i + 1][0] : TOTAL);

// Energy per layer over time, so the music follows the tour.
const env = (t, pts) => { // piecewise-linear [t, v] points
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) if (t < pts[i + 1][0]) return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * ((t - pts[i][0]) / (pts[i + 1][0] - pts[i][0]));
  return pts[pts.length - 1][1];
};
// From the tour's own cues: drums while things are being built, out for the
// quiet beats, the arpeggio a little brighter whenever the drums are in.
const DRUMS = [[0, 0]], ARP = [[0, 0], [CUES_.arpIn, 0], [CUES_.arpIn + 0.6, 0.55]];
for (const [a, b] of CUES_.drums) {
  DRUMS.push([a - 0.4, 0], [a, 1], [b, 1], [b + 0.4, 0]);
  ARP.push([a - 0.4, 0.55], [a, 0.75], [b, 0.75], [b + 0.4, 0.55]);
}
ARP.push([END_, 0.8], [END_ + 0.6, 0.35], [TOTAL, 0]);
const BASS = [[0, 0], [CUES_.bassIn, 0], [CUES_.bassIn + 1.5, 0.8], [END_, 0.8], [END_ + 4, 0.5], [TOTAL, 0]];

function add(buf, i, v) { if (i >= 0 && i < N) buf[i] += v; }
function pan(p) { return [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)]; }

// Pad: detuned additive voices with a slow swell, mostly into the reverb.
SCHEDULE.forEach(([s, name], i) => {
  const e = chordEnd(i), len = e - s + 1.2;
  const notes = CH[name];
  notes.forEach((m, vi) => {
    for (const det of [-0.08, 0.08]) {
      const f = hz(m + det), [pl, pr] = pan(vi % 2 ? 0.35 : -0.35);
      const i0 = Math.floor(s * SR), n = Math.floor(len * SR);
      let ph = (vi * 1.7 + det * 10 + 7) % 6.28; // fixed, so every render sounds the same
      for (let j = 0; j < n; j++) {
        const t = j / SR;
        const a = Math.min(1, t / 1.1) * Math.min(1, (len - t) / 1.2);
        ph += (2 * Math.PI * f) / SR;
        const v = (Math.sin(ph) + 0.28 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph)) * a * 0.011;
        add(L, i0 + j, v * pl * 0.5); add(R, i0 + j, v * pr * 0.5);
        add(sendL, i0 + j, v * pl); add(sendR, i0 + j, v * pr);
      }
    }
  });
});

// Pluck: eighth-note arpeggio an octave up, alternating sides.
const PATTERN = [0, 2, 4, 1, 3, 4, 2, 4];
for (let k = 0, t0 = 0; t0 < TOTAL; k++, t0 = (k * BEAT) / 2) {
  const g = env(t0, ARP);
  if (g <= 0.001) continue;
  const slow = t0 >= END_; // quarter notes over the end card
  if (slow && k % 2) continue;
  const m = CH[chordAt(t0)][PATTERN[k % 8]] + 12;
  const f = hz(m), [pl, pr] = pan(k % 2 ? 0.45 : -0.45);
  const i0 = Math.floor(t0 * SR), n = Math.floor(1.1 * SR);
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    const a = Math.min(1, t / 0.004) * Math.exp(-t * 5.5);
    const v = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 9)) * a * 0.05 * g;
    add(L, i0 + j, v * pl); add(R, i0 + j, v * pr);
    add(sendL, i0 + j, v * pl * 0.6); add(sendR, i0 + j, v * pr * 0.6);
  }
}

// Sub bass: the root on beats 1 and 3.
for (let b = 0; b * BEAT < TOTAL; b += 2) {
  const t0 = b * BEAT, g = env(t0, BASS);
  if (g <= 0.001) continue;
  const f = hz(CH[chordAt(t0)][0] - 12);
  // Notes overlap by a release, so the bass is legato rather than pumping.
  const i0 = Math.floor(t0 * SR), n = Math.floor((BEAT * 2 + 0.3) * SR);
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    const a = Math.min(1, t / 0.03) * Math.min(1, (n / SR - t) / 0.3);
    const v = Math.sin(2 * Math.PI * f * t) * a * 0.045 * g;
    add(L, i0 + j, v); add(R, i0 + j, v);
  }
}

// Drums: a soft kick on 1 and 3, a closed hat on the off-beats.
let seed = 7;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
for (let b = 0; b * BEAT < TOTAL; b++) {
  const t0 = b * BEAT, g = env(t0, DRUMS);
  if (g <= 0.001) continue;
  if (b % 2 === 0) {
    const i0 = Math.floor(t0 * SR), n = Math.floor(0.35 * SR);
    let ph = 0;
    for (let j = 0; j < n; j++) {
      const t = j / SR;
      ph += (2 * Math.PI * (48 + 90 * Math.exp(-t * 32))) / SR;
      const v = Math.sin(ph) * Math.exp(-t * 11) * 0.16 * g;
      add(L, i0 + j, v); add(R, i0 + j, v);
    }
  }
  const th = t0 + BEAT / 2, i0 = Math.floor(th * SR), n = Math.floor(0.06 * SR);
  let prev = 0;
  for (let j = 0; j < n; j++) {
    const t = j / SR, x = noise();
    const hp = x - prev; prev = x; // crude high-pass: hats, not hiss
    const v = hp * Math.exp(-t * 70) * 0.022 * g;
    add(L, i0 + j, v * 0.8); add(R, i0 + j, v);
  }
}

// UI ticks on every click, and a soft bell as each beat's label appears.
for (const c of CLICKS) {
  const i0 = Math.floor(c * SR), n = Math.floor(0.03 * SR);
  for (let j = 0; j < n; j++) {
    const t = j / SR, v = Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 260) * 0.05;
    add(L, i0 + j, v); add(R, i0 + j, v);
  }
}
for (const lt of [...LABELS, END_]) {
  const f = hz(CH[chordAt(lt + 0.01)][2] + 24), i0 = Math.floor(lt * SR), n = Math.floor(2.4 * SR);
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    const v = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 6)) * Math.exp(-t * 2.2) * Math.min(1, t / 0.003) * 0.03;
    add(L, i0 + j, v); add(R, i0 + j, v);
    add(sendL, i0 + j, v); add(sendR, i0 + j, v);
  }
}

// Reverb on the send bus: four damped combs and two all-passes per side.
function reverb(input, offset) {
  const out = new Float32Array(N);
  for (const d0 of [1557, 1617, 1491, 1422]) {
    const d = d0 + offset, buf = new Float32Array(d);
    let idx = 0, lp = 0;
    for (let i = 0; i < N; i++) {
      const y = buf[idx];
      lp = y * 0.8 + lp * 0.2;
      buf[idx] = input[i] + lp * 0.84;
      out[i] += y * 0.25;
      idx = (idx + 1) % d;
    }
  }
  for (const d0 of [556, 225]) {
    const d = d0 + offset, buf = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < N; i++) {
      const b = buf[idx], x = out[i];
      out[i] = -x + b;
      buf[idx] = x + b * 0.5;
      idx = (idx + 1) % d;
    }
  }
  return out;
}
const wl = reverb(sendL, 0), wr = reverb(sendR, 23);

// Mix, fade, and normalise to -1 dBFS. No clipper: driving one put a buzz on the bass.
const fadeIn = 0.6, fadeOut = 3.5;
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, f = Math.min(1, t / fadeIn) * Math.min(1, (TOTAL - t) / fadeOut);
  L[i] = (L[i] + wl[i] * 0.55) * f;
  R[i] = (R[i] + wr[i] * 0.55) * f;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.891 / peak;
const pcm = Buffer.alloc(44 + N * 4);
pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write("WAVE", 8); pcm.write("fmt ", 12);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.round(L[i] * gain * 32767), 44 + i * 4);
  pcm.writeInt16LE(Math.round(R[i] * gain * 32767), 46 + i * 4);
}
mkdirSync(new URL("./music/", import.meta.url), { recursive: true });
writeFileSync(new URL("./music/music.wav", import.meta.url), pcm);
console.log(`wrote music/music.wav · ${TOTAL}s · ${CLICKS.length} clicks · ${LABELS.length} beats`);
