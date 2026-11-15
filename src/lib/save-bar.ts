// The pending bar of the live pages (the plan dashboard and the story map): the saves not yet committed, with
// the Commit and Push buttons, and a list of the files they changed. Both pages share this script and style. The script is for one page's server,
// so it names the command that runs that server, for the message when the server can't be reached.

/** The bar's style: the notice box it sits in, and its buttons. */
export const SAVE_BAR_CSS = `.pending{background:var(--accent);color:var(--accent-fg);padding:10px 12px 10px 16px;border-radius:var(--r,10px);margin:12px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;font-size:.92rem}
.pending button{font:inherit;font-weight:600;padding:5px 12px;border-radius:7px;border:1px solid color-mix(in srgb,currentColor 50%,transparent);background:transparent;color:inherit;cursor:pointer}
.pending button:first-of-type{background:var(--accent-fg);color:var(--accent);border-color:transparent}
.pending button:disabled{opacity:.6;cursor:progress}
.pending[hidden]{display:none}
.pending-list{flex-basis:100%;margin:2px 0 0;padding:8px 12px;list-style:none;display:grid;gap:3px;border-radius:7px;background:color-mix(in srgb,var(--accent-fg) 14%,transparent);font-size:.85rem}
.pending-list b{display:inline-block;min-width:4.8em;font-weight:600}
.pending-list[hidden]{display:none}`;

/**
 * The bar's script, for a page (named `what`, as the message says) that saves through the server `command` runs.
 * It reads the token from the page's nikos-token meta tag, and defines call (a request with the token), errorOf,
 * gone, pendingBar and button. It loads the bar's list of saves at once, and again after each commit or push.
 * See changes shows which files those saves changed, by git's status, and stays open while the bar reloads.
 */
export function saveBarScript(command: string, what: string): string {
  const unreachable = JSON.stringify(`Couldn't reach the ${what}. Is ${command} still running?`);
  return `var meta = document.querySelector('meta[name="nikos-token"]');
var token = meta ? meta.getAttribute("content") : "";
var bar = document.getElementById("pending");
var listOpen = false;
function call(method, path, body) {
  var init = { method: method, headers: { "content-type": "application/json", "x-nikos-token": token }, credentials: "same-origin" };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(path, init).then(function (r) {
    return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }, function () { return { ok: r.ok, status: r.status, body: {} }; });
  });
}
function errorOf(res) { return res.body && res.body.error ? res.body.error : "Something went wrong."; }
function gone() { return ${unreachable}; }
function pendingBar() {
  call("GET", "/api/pending").then(function (res) {
    if (!bar) return;
    bar.textContent = "";
    if (!res.ok) { bar.hidden = false; bar.textContent = errorOf(res); return; }
    var files = res.body.files || [];
    if (!files.length) { bar.hidden = true; return; }
    bar.hidden = false;
    var text = document.createElement("span");
    text.textContent = files.length + (files.length === 1 ? " saved change" : " saved changes") + (res.body.branch ? " on " + res.body.branch : "") + ". Nothing is pushed until you press Push. ";
    bar.appendChild(text);
    var msg = document.createElement("span");
    msg.className = "save-msg";
    bar.appendChild(button("Commit", "/api/git/commit", msg));
    if (res.body.branch && res.body.hasOrigin) bar.appendChild(button("Push", "/api/git/push", msg));
    var list = changeList(files, res.body.paths || []);
    var see = document.createElement("button");
    see.type = "button";
    see.setAttribute("aria-expanded", String(listOpen));
    see.textContent = listOpen ? "Hide changes" : "See changes";
    see.addEventListener("click", function () {
      listOpen = !listOpen;
      list.hidden = !listOpen;
      see.setAttribute("aria-expanded", String(listOpen));
      see.textContent = listOpen ? "Hide changes" : "See changes";
    });
    bar.appendChild(see);
    bar.appendChild(msg);
    bar.appendChild(list);
  }, function () { if (bar) { bar.hidden = false; bar.textContent = gone(); } });
}
// One line per file a commit would take: whether it is new, changed or removed, and its path.
function changeList(files, paths) {
  var list = document.createElement("ul");
  list.className = "pending-list";
  list.hidden = !listOpen;
  for (var i = 0; i < files.length; i++) {
    var code = String(files[i]).slice(0, 2).trim();
    var li = document.createElement("li");
    var kind = document.createElement("b");
    kind.textContent = code === "??" || code === "A" ? "New" : code === "D" ? "Removed" : "Changed";
    li.appendChild(kind);
    li.appendChild(document.createTextNode(" " + (paths[i] || String(files[i]).slice(3))));
    list.appendChild(li);
  }
  return list;
}
function button(label, path, msg) {
  var b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", function () {
    b.disabled = true;
    msg.textContent = "Working…";
    call("POST", path, {}).then(function (res) {
      if (!res.ok) { msg.textContent = errorOf(res); b.disabled = false; return; }
      msg.textContent = res.body.committed ? "Committed " + String(res.body.committed).slice(0, 7) : res.body.pushed ? "Pushed " + res.body.pushed : "Done";
      pendingBar();
    }, function () { msg.textContent = gone(); b.disabled = false; });
  });
  return b;
}
`;
}
