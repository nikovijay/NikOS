// Writes site/index.html from site/packs.json, so a new pack shows up on the
// homepage by adding it to the list. Run: node scripts/build-site.mjs
import { readFileSync, writeFileSync } from "node:fs";

const site = new URL("../site/", import.meta.url);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const TAGLINE = "Spec-driven development for AI coding agents: your agent proves a story works before it calls it done.";

export function renderSite(packs) {
  const cards = packs
    .map(
      (p) => `      <li class="pack" id="${esc(p.id)}">
        <h3>${esc(p.name)}</h3>
        <ul class="tags">${p.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        <p>${esc(p.summary)}</p>
        <pre class="install"><code>${esc(p.install)}</code></pre>
        <a class="more" href="${esc(p.page)}">About this pack</a>
      </li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nikOS tools</title>
  <meta name="description" content="${esc(TAGLINE)}">
  <link rel="icon" href="icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="tokens.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top wrap">
    <a class="wordmark" href="/">nikOS</a>
    <nav class="nav" aria-label="Main">
      <a href="#packs">Packs</a>
      <a href="https://github.com/nikovijay/NikOS/blob/main/docs/quickstart.md">Quickstart</a>
      <a href="https://github.com/nikovijay/NikOS">GitHub</a>
    </nav>
  </header>
  <main>
    <section class="hero wrap">
      <img src="header.svg" alt="nikOS" width="896" height="330">
      <h1>${esc(TAGLINE)}</h1>
      <p>Open-source tool packs for Claude Code, Codex and Cursor. Each pack is a set of skills and playbooks your agent follows, with the evidence to show it did.</p>
    </section>
    <section class="packs wrap" id="packs" aria-labelledby="packs-title">
      <h2 class="label" id="packs-title">Tool packs · ${packs.length}</h2>
      <ul class="pack-list">
${cards}
      </ul>
    </section>
  </main>
  <footer class="wrap">
    <p>Made by <a href="https://x.com/nikovijay">@nikovijay</a>. Open source, MIT licensed.</p>
    <p>Design tokens from the Signal Design System by Archetype AI (MIT).</p>
  </footer>
</body>
</html>
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const packs = JSON.parse(readFileSync(new URL("packs.json", site), "utf8"));
  writeFileSync(new URL("index.html", site), renderSite(packs));
  console.log(`site/index.html: ${packs.length} pack(s)`);
}
