// The look nikOS's pages share: the plan dashboard, its offline export, and the story map. Colour tokens for
// light and dark, the type stacks, and the small parts every page uses (buttons, pills, chips, the host label
// and the page's own dialogs). The fonts are the computer's own, so a page looks the same offline and exported.
import { darkRules } from "./theme.js";

/** The colour tokens, light first. Each page builds its own parts from these. */
const LIGHT = `:root{--bg:#f5f4f8;--surface:#ffffff;--surface-2:#eeecf4;--line:#dcd9e6;--line-strong:#c4c0d4;--fg:#1a1922;--muted:#5f5c6d;--accent:#5b3fb0;--accent-weak:#ebe6fa;--accent-fg:#ffffff;--good:#1d6a42;--good-bg:#def1e6;--warn:#875700;--warn-bg:#fcefd1;--bad:#b02e29;--bad-bg:#fbe3e1;--idle:#5b5966;--idle-bg:#e9e8ee;--notice:#fff6dc;--notice-fg:#4a3700;--wire:#b9b0dc;--shadow:0 1px 2px rgb(26 25 34 / .06),0 4px 16px rgb(26 25 34 / .06);--r:10px;--f-display:"Avenir Next","Segoe UI Variable Display","Segoe UI",ui-sans-serif,system-ui,sans-serif;--f-body:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--f-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}`;
const DARK = `:root{--bg:#121118;--surface:#1b1a23;--surface-2:#24222e;--line:#33303f;--line-strong:#4a465a;--fg:#ecebf2;--muted:#a4a1b2;--accent:#b8a5ff;--accent-weak:#2b2447;--accent-fg:#150e2c;--good:#8ed6ac;--good-bg:#17321f;--warn:#f0c46e;--warn-bg:#382a0e;--bad:#ff9c94;--bad-bg:#3c1a19;--idle:#b5b3bf;--idle-bg:#2a2833;--notice:#352b10;--notice-fg:#ffe6a3;--wire:#4f4677;--shadow:0 1px 2px rgb(0 0 0 / .3),0 4px 16px rgb(0 0 0 / .25)}`;

/** The base every page starts from: tokens, type, focus, and the shared parts. */
export const DESIGN_CSS = `${LIGHT}
${darkRules(DARK)}
*{box-sizing:border-box}
html,body{background:var(--bg);color:var(--fg)}
body{font-family:var(--f-body);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
h1,h2,h3{font-family:var(--f-display);text-wrap:balance;font-weight:700;letter-spacing:-.01em}
.mono,code{font-family:var(--f-mono);font-size:.85em}
.muted{color:var(--muted)}
.eyebrow{font-size:.72rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);font-weight:600}
.num{font-variant-numeric:tabular-nums}
.skip{position:absolute;left:-999px;top:8px;background:var(--accent);color:var(--accent-fg);padding:8px 12px;border-radius:6px;z-index:50}
.skip:focus{left:16px}
.btn{border:1px solid var(--line-strong);background:var(--surface);border-radius:8px;padding:6px 14px;cursor:pointer;font-weight:600;font-size:.9rem;color:var(--fg)}
.btn:hover{border-color:var(--fg)}
.btn.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.btn.primary:hover{filter:brightness(1.08)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.pill{display:inline-flex;align-items:center;gap:5px;font-size:.75rem;font-weight:600;border-radius:99px;padding:1px 9px;line-height:1.7;white-space:nowrap}
.pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.s-good{background:var(--good-bg);color:var(--good)}.s-warn{background:var(--warn-bg);color:var(--warn)}.s-bad{background:var(--bad-bg);color:var(--bad)}.s-idle{background:var(--idle-bg);color:var(--idle)}.s-accent{background:var(--accent-weak);color:var(--accent)}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:.78rem;border:1px solid var(--line);background:var(--surface);border-radius:6px;padding:1px 8px;color:var(--fg);text-decoration:none;max-width:100%}
.host{display:inline-flex;align-items:center;font-size:.78rem;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface);max-width:100%}
.host-k{background:var(--surface-2);padding:5px 8px;font-weight:600;white-space:nowrap}
.host-v{padding:5px 8px;font-family:var(--f-mono);font-size:.74rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.theme-toggle{border:1px solid var(--line);background:var(--surface);border-radius:8px;padding:5px 10px;font-size:.85rem}
dialog.sheet-dialog{border:0;padding:0;background:var(--bg);color:var(--fg);border-radius:14px;box-shadow:0 20px 60px rgb(0 0 0 / .3);max-width:min(600px,calc(100% - 32px));width:100%}
dialog.sheet-dialog::backdrop{background:rgb(10 8 20 / .35)}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}`;
