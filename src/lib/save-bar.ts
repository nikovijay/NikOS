// The pending bar of the live pages (the plan dashboard and the story map): the saves not yet committed, with
// the Commit and Push buttons. Both pages share this script and style. The script is for one page's server,
// so it names the command that runs that server, for the message when the server can't be reached.

/** The bar's style: the notice box it sits in, and its buttons. */
export const SAVE_BAR_CSS = `.pending{background:var(--notice);color:var(--notice-fg);padding:.5rem .75rem;border-radius:.4rem;margin-bottom:.75rem}
.pending button{font:inherit;margin-left:.4rem;padding:.2rem .6rem}`;

/**
 * The bar's script, for a page (named `what`, as the message says) that saves through the server `command` runs.
 * It reads the token from the page's nikos-token meta tag, and defines call (a request with the token), errorOf,
 * gone, pendingBar and button. It loads the bar's list of saves at once, and again after each commit or push.
 */
export function saveBarScript(command: string, what: string): string {
  const unreachable = JSON.stringify(`Couldn't reach the ${what}. Is ${command} still running?`);
  return `var meta = document.querySelector('meta[name="nikos-token"]');
var token = meta ? meta.getAttribute("content") : "";
var bar = document.getElementById("pending");
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
    bar.appendChild(msg);
  }, function () { if (bar) { bar.hidden = false; bar.textContent = gone(); } });
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
