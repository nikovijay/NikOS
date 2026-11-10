// The offline page for nikos plan serve --export: every page the export needs, built ahead of time, in one
// HTML file that moves between them with no server. Each page is keyed by its query (at=, view=, widen=, kr=,
// bet=), the same query its links carry, so the file's own script only swaps the body and keeps the place in
// the URL, both ?at= and #at=. Nothing in the file asks for anything over the network.
import { STYLE } from "./page.js";

/** A page as the export keeps it: its title as plain text, and the content of its body. */
export interface OfflinePage {
  title: string;
  body: string;
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The page keys a body links to: each href or option value that is a query on this dashboard, normalised. */
export function linksIn(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/(?:href|value)="\?([^"]*)"/g)) out.push(new URLSearchParams(unescape(m[1]!)).toString());
  return out;
}

/** The query a page key stands for, normalised as the script normalises it. */
export function keyOf(query: Record<string, string>): string {
  return new URLSearchParams(query).toString();
}

/**
 * The file. The script shows the page the URL names (?at= or #at=), or the start page. A link or picker
 * choice to a page that isn't in the file is said so, rather than leaving the file.
 */
export function offlineDocument(pages: Record<string, OfflinePage>, start: string): string {
  const first = pages[start] ?? Object.values(pages)[0];
  // Angle brackets are escaped so no page can end the script early.
  const data = JSON.stringify(pages).replace(/</g, "\\u003c");
  const script = `(function () {
var pages = ${data};
var start = ${JSON.stringify(start)};
function has(key) { return Object.prototype.hasOwnProperty.call(pages, key); }
function norm(s) { return new URLSearchParams(s).toString(); }
function notice(text) {
  var p = document.createElement("p");
  p.className = "notice";
  p.textContent = text;
  document.body.insertBefore(p, document.body.firstChild);
}
function show(key) {
  if (!has(key)) {
    notice("That page isn't in this file. Export without --in to include every area.");
    return;
  }
  document.title = pages[key].title;
  document.body.innerHTML = pages[key].body;
  history.replaceState(null, "", "?" + key + "#" + key);
  window.scrollTo(0, 0);
}
var here = norm(location.search.slice(1));
var there = norm(location.hash.slice(1));
show(has(here) ? here : has(there) ? there : start);
document.addEventListener("click", function (e) {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
  if (!a) return;
  var href = a.getAttribute("href");
  if (href.charAt(0) !== "?") return;
  e.preventDefault();
  show(norm(href.slice(1)));
});
document.addEventListener("change", function (e) {
  var t = e.target;
  if (t && t.tagName === "SELECT" && t.value.charAt(0) === "?") show(norm(t.value.slice(1)));
});
})();`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(first?.title ?? "nikOS plan")}</title><style>${STYLE}</style></head>
<body>
${first?.body ?? ""}<script>
${script}
</script>
</body></html>
`;
}
