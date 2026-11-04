// Writes assets/header.svg: Niko's logo as ASCII, pulling apart to show "nikOS"
// and closing again. Plain SVG + SMIL, so it animates as an <img> on GitHub and
// npm, where READMEs can't run scripts. Run: node scripts/header-svg.mjs
import { writeFileSync } from "node:fs";

const COLS = 112, ROWS = 22, CW = 8, CH = 15; // grid size and cell size in px
const W = COLS * CW, H = ROWS * CH;
const T = 9; // loop length, seconds

// Seeded random, so the file is the same every run.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (s) => s[Math.floor(rand() * s.length)];

// The logo: two strokes, from assets/icon.svg.
const strokes = [
  [[287, 252], [179, 483], [180, 485], [253, 484], [324, 331]],
  [[504, 251], [431, 251], [360, 404], [396, 483], [398, 482], [501, 261]],
];
const inside = (poly, x, y) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

// Fit the logo into 48 x 18 cells in the middle of the grid.
const LC = 48, LR = 18, x0 = 179, y0 = 251, sx = (504 - 179) / LC, sy = (485 - 251) / LR;
const ox = Math.round((COLS - LC) / 2), oy = Math.round((ROWS - LR) / 2);
const cells = strokes.map((poly) => {
  const out = [];
  for (let r = 0; r < LR; r++)
    for (let c = 0; c < LC; c++) {
      let hit = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) hit += inside(poly, x0 + (c + (i + 0.5) / 4) * sx, y0 + (r + (j + 0.5) / 4) * sy);
      const cover = hit / 16;
      if (cover < 0.2) continue;
      // Solid inside, slashes along the slanted edges.
      const ch = cover > 0.85 ? pick("#@%&$") : cover > 0.5 ? "/" : pick("/:;");
      out.push({ c: ox + c, r: oy + r, ch, bright: cover > 0.5 });
    }
  return out;
});

// "nikOS" in a 5 x 7 pixel font, two cells per pixel so it reads at a glance.
const font = {
  n: ["     ", "     ", "#### ", "#   #", "#   #", "#   #", "#   #"],
  i: ["  #  ", "     ", " ##  ", "  #  ", "  #  ", "  #  ", " ### "],
  k: ["#    ", "#    ", "#  # ", "# #  ", "##   ", "# #  ", "#  # "],
  O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  S: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
};
const word = "nikOS", tw = word.length * 12 - 2;
const tx = Math.round((COLS - tw) / 2), ty = Math.round((ROWS - 7) / 2);
const text = [];
[...word].forEach((l, k) => font[l].forEach((row, r) => [...row].forEach((p, c) => {
  if (p !== "#") return;
  for (const d of [0, 1]) text.push({ c: tx + k * 12 + c * 2 + d, r: ty + r, ch: l === "O" || l === "S" ? pick("@#%") : pick("#$&") });
})));

// Each half moves out just far enough to leave two clear columns either side of the word.
const rows = (r) => r >= ty - 1 && r <= ty + 7;
const SPLIT = Math.max(
  ...cells[0].filter((g) => rows(g.r)).map((g) => g.c - (tx - 3)),
  ...cells[1].filter((g) => rows(g.r)).map((g) => tx + tw + 2 - g.c),
);
const kt = { hold: 0.16, open: 0.27, close: 0.76, shut: 0.87 };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt = (n) => +n.toFixed(4);

// The halves move a whole column at a time, eased, like a terminal redraw.
const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
function slide(dir) {
  const times = [0], values = ["0 0"];
  const steps = (a, b, from, to) => {
    for (let s = 1; s <= SPLIT; s++) {
      // The time at which the eased position crosses column s.
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; ease(m) * SPLIT < s - 0.5 ? (lo = m) : (hi = m); }
      times.push(fmt(a + (b - a) * lo));
      const col = from + (to > from ? s : -s);
      values.push(`${dir * col * CW} 0`);
    }
  };
  steps(kt.hold, kt.open, 0, SPLIT);
  steps(kt.close, kt.shut, SPLIT, 0);
  return `<animateTransform attributeName="transform" type="translate" dur="${T}s" repeatCount="indefinite" calcMode="discrete" keyTimes="${times.join(";")}" values="${values.join(";")}"/>`;
}

const glyph = (x, y, ch, cls, extra = "") => `<text x="${x * CW + CW / 2}" y="${y * CH + CH * 0.72}" class="${cls}"${extra}>${esc(ch)}</text>`;

// A few logo cells flicker, like a CRT.
const flicker = () => {
  const at = rand() * 0.9;
  return `<animate attributeName="opacity" dur="${(2 + rand() * 3).toFixed(2)}s" repeatCount="indefinite" keyTimes="0;${fmt(at)};${fmt(at + 0.03)};${fmt(at + 0.06)};1" values="1;1;0.25;1;1"/>`;
};

const logo = cells.map((half, i) => `<g>${slide(i === 0 ? -1 : 1)}${half
  .map((g) => (rand() < 0.12 ? glyph(g.c, g.r, g.ch, g.bright ? "b" : "m", "") .replace("</text>", `${flicker()}</text>`) : glyph(g.c, g.r, g.ch, g.bright ? "b" : "m")))
  .join("")}</g>`).join("");

// Each letter cell decodes in: a random glyph flashes, then the real one settles.
const SCRAMBLE = "!<>-_\\/[]{}=+*^?#01";
const word$ = text.map((g) => {
  const a = kt.open + 0.01 + rand() * 0.07, b = a + 0.02 + rand() * 0.02;
  const out = kt.close - 0.06 + rand() * 0.05;
  const settle = `keyTimes="0;${fmt(b)};${fmt(out)};${fmt(out + 0.012)};1" values="0;1;1;0;0"`;
  const noise = `keyTimes="0;${fmt(a)};${fmt(b)};1" values="0;1;0;0"`;
  return glyph(g.c, g.r, pick(SCRAMBLE), "s", "").replace("</text>", `<animate attributeName="opacity" dur="${T}s" repeatCount="indefinite" calcMode="discrete" ${noise}/></text>`)
    + glyph(g.c, g.r, g.ch, "w", "").replace("</text>", `<animate attributeName="opacity" dur="${T}s" repeatCount="indefinite" calcMode="discrete" ${settle}/></text>`);
}).join("");

// A dim field of characters behind everything. Rows are pinned to the grid
// width with textLength so any monospace font lines up.
const field = Array.from({ length: ROWS }, (_, r) => {
  const row = Array.from({ length: COLS }, () => (rand() < 0.55 ? " " : pick(".:-=+*'`"))).join("");
  return `<text x="${CW / 2}" y="${r * CH + CH * 0.72}" class="f" textLength="${W - CW}" lengthAdjust="spacing" xml:space="preserve">${esc(row)}</text>`;
}).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="nikOS: spec-driven development for AI coding agents">
<title>nikOS</title>
<defs>
<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity="0.35"/></pattern>
<radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.6"/></radialGradient>
</defs>
<style>
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:13px;font-weight:700;text-anchor:middle}
.f{fill:#0f3a1d;text-anchor:start;font-weight:400}
.b{fill:#3dff7a}.m{fill:#1f9e4a}.w{fill:#b6ffcb}.s{fill:#3dff7a}
</style>
<rect width="${W}" height="${H}" rx="14" fill="#04140a"/>
${field}
<g filter="url(#glow)">${logo}${word$}</g>
<rect width="${W}" height="${H}" rx="14" fill="url(#scan)"/>
<rect width="${W}" height="${H}" rx="14" fill="url(#vig)"/>
</svg>
`;
writeFileSync(new URL("../assets/header.svg", import.meta.url), svg);
console.log(`assets/header.svg: ${(svg.length / 1024).toFixed(1)} KB, ${cells[0].length + cells[1].length} logo cells, ${text.length} letter cells`);
