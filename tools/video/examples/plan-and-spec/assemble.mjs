// Builds tour.html from tour.src.html and the pages in screens/. Each page goes in as an iframe's srcdoc, so
// the tour can reach into it, with its scripts taken out and its transitions off: every frame is drawn from
// the time alone, and the tour sets what a page's own script would have (an open form, the save bar).
//   node assemble.mjs   (after node sample/build.mjs <folder>)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const STILL = "<style>*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}</style>";
const screens = {};
for (const f of readdirSync(new URL("./screens/", import.meta.url)).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(new URL(`./screens/${f}`, import.meta.url), "utf8");
  screens[f.replace(/\.html$/, "")] = html.replace(/<script\b[\s\S]*?<\/script>/g, "").replace("</head>", `${STILL}</head>`);
}
const terminal = readFileSync(new URL("./screens/terminal.json", import.meta.url), "utf8");
const src = readFileSync(new URL("./tour.src.html", import.meta.url), "utf8");
// JSON in a script: keep "</" from closing the tag early.
const data = `<script>window.SCREENS = ${JSON.stringify(screens).replace(/<\//g, "<\\/")};\nwindow.TERMINAL = ${terminal.replace(/<\//g, "<\\/")};</script>`;
writeFileSync(new URL("./tour.html", import.meta.url), src.replace("<!-- SCREENS -->", data));
console.log(`tour.html: ${Object.keys(screens).length} pages`);
