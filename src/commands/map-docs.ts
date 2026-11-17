// The story map's two reference documents, read-only on the live page: the constitution (what the product
// is for) and the decisions made along the way. Both live at the root of the code repo, beside maps/.
import { join } from "node:path";
import { parse } from "yaml";
import { store } from "../lib/store.js";
import { decisionsPath, read } from "../lib/project.js";
import { decisionEntries } from "./decisions.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Bold and code in one line of escaped text. */
function inline(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

/**
 * A small, safe reading of Markdown: headings, paragraphs, lists, bold and code. Everything else is shown as
 * text, so nothing in the file can add markup to the page.
 */
export function markdown(text: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join(" ")}</p>`);
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`);
    para = [];
    list = [];
  };
  let comment = false;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line.trim().startsWith("<!--")) comment = true;
    if (comment) {
      if (line.includes("-->")) comment = false;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = Math.min(4, h[1].length + 2);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (item) {
      if (para.length) flush();
      list.push(item[1]);
    } else if (!line.trim()) flush();
    else {
      if (list.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return out.join("");
}

interface Decision {
  date: string;
  title: string;
  story?: string;
  category: string;
  supersedes: string;
  body: string;
}

/** decisions.md's entries, newest first, each split into its heading, category, supersedes and text. */
export function decisionsOf(dir: string): Decision[] {
  return decisionEntries(dir)
    .map((e) => {
      const [head, ...rest] = e.text.split("\n");
      const m = /^##\s+(\d{4}-\d{2}-\d{2})\s+[—-]\s+(.*?)(?:\s+\(([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+)\))?\s*$/.exec(head);
      const field = (name: string) => rest.find((l) => l.startsWith(`**${name}:**`))?.slice(name.length + 5).trim() ?? "";
      const body = rest.filter((l) => !/^\*\*(Category|Supersedes):\*\*/.test(l)).join("\n").trim();
      return m
        ? { date: m[1], title: m[2], story: m[3], category: field("Category"), supersedes: field("Supersedes"), body }
        : { date: "", title: head.replace(/^##\s+/, ""), category: field("Category"), supersedes: field("Supersedes"), body };
    })
    .reverse();
}

/** The constitution's front matter (name, idea) and its body, or undefined when there is no constitution.md. */
function constitutionOf(dir: string): { name: string; idea: string; body: string } | undefined {
  const path = join(dir, "constitution.md");
  if (!store().exists(path)) return undefined;
  const text = read(path);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  let meta: Record<string, unknown> = {};
  try {
    meta = fm ? ((parse(fm[1]) as Record<string, unknown>) ?? {}) : {};
  } catch {
    // Front matter that isn't YAML is shown as part of the text.
  }
  return { name: String(meta.name ?? ""), idea: String(meta.idea ?? ""), body: fm ? text.slice(fm[0].length) : text };
}

/** The two links beside the map's title that open the documents. */
export function docLinks(dir: string): string {
  const n = decisionEntries(dir).length;
  return `<span class="doc-links"><button type="button" class="doc-link" data-open-dialog="constitution">Constitution</button><button type="button" class="doc-link" data-open-dialog="decisions">Decisions<span class="count">${n}</span></button></span>`;
}

/** The constitution and decisions dialogs. Read-only: both files are changed in the repo, by hand or with nikos decide. */
export function docDialogs(dir: string, storyIds: Set<string>): string {
  const head = (id: string, title: string) =>
    `<div class="dialog-head"><h2 id="${id}-title">${esc(title)}</h2><button type="button" class="close" data-close-dialog aria-label="Close">×</button></div>`;
  const c = constitutionOf(dir);
  const constitution = c
    ? `${c.name || c.idea ? `<div class="doc-lede">${c.name ? `<strong>${esc(c.name)}</strong>` : ""}${c.idea ? `<span>${esc(c.idea)}</span>` : ""}</div>` : ""}<div class="doc-body">${markdown(c.body)}</div>`
    : `<p class="where">This repo has no constitution.md yet. <code>nikos init</code> makes one, and your agent can fill it in with you.</p>`;
  const list = decisionsOf(dir);
  const decisions = list.length
    ? `<ol class="decisions">${list
        .map(
          (d) =>
            `<li class="decision"><div class="d-head">${d.date ? `<span class="d-date">${esc(d.date)}</span>` : ""}${d.category ? `<span class="d-cat">${esc(d.category)}</span>` : ""}${
              d.story ? (storyIds.has(d.story) ? `<a class="sid" href="#story-${esc(d.story)}" data-close-dialog>${esc(d.story)}</a>` : `<span class="sid">${esc(d.story)}</span>`) : ""
            }</div><h3>${esc(d.title)}</h3>${d.supersedes && d.supersedes !== "none" ? `<p class="where">Supersedes ${esc(d.supersedes)}</p>` : ""}<div class="doc-body">${markdown(d.body)}</div></li>`,
        )
        .join("")}</ol>`
    : `<p class="where">No decisions yet.</p>`;
  const where = `decisions.md, newest first. Add one with <code>nikos decide "&lt;title&gt;" --why "&lt;what you chose and what you rejected&gt;"</code>. Earlier entries are never edited.`;
  return `<dialog id="constitution" class="sheet-dialog doc-dialog" aria-labelledby="constitution-title"><div class="dialog-body">${head("constitution", "Constitution")}<p class="where">constitution.md: who the product is for, the problem, and how you'll know it works.</p>${constitution}</div></dialog>
<dialog id="decisions" class="sheet-dialog doc-dialog" aria-labelledby="decisions-title"><div class="dialog-body">${head("decisions", "Decisions")}<p class="where">${where}</p>${decisions}</div></dialog>`;
}

export const DOCS_CSS = `
.doc-links { display: inline-flex; gap: 4px; }
.doc-link { font: inherit; font-size: 13px; font-weight: 500; min-height: 26px; padding: 0 9px; border: 1px solid var(--line); border-radius: 99px; background: var(--surface); color: var(--fg); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.doc-link:hover { border-color: var(--line-strong); }
.doc-dialog .dialog-body { max-width: 720px; }
.doc-lede { display: grid; gap: 2px; padding: 12px 14px; border-radius: var(--r); background: var(--accent-weak); margin: 8px 0 4px; }
.doc-lede span { color: var(--muted); }
.doc-body h3, .doc-body h4, .doc-body h5, .doc-body h6 { margin: 16px 0 4px; font-size: 15px; }
.doc-body p { margin: 0 0 8px; line-height: 1.5; }
.doc-body ul { margin: 0 0 8px; padding-left: 20px; }
.decisions { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 10px; }
.decision { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); padding: 10px 14px; }
.decision h3 { margin: 4px 0 6px; font-family: var(--f-body); font-size: 15px; }
.d-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); }
.d-date { font-family: var(--f-mono); }
.d-cat { padding: 1px 8px; border-radius: 99px; background: var(--surface-2); text-transform: capitalize; }
`;
