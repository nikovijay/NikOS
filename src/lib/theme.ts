// The light/dark switch on nikOS's pages (the plan dashboard, its offline export, and the story map). A page
// follows the browser's light or dark setting until someone presses the switch; the choice is then kept in
// this browser for that page's address, and the page sets data-theme on <html>.

const KEY = "nikos-theme";

/**
 * For the <head>: applies a kept choice before the page draws, and handles the switch. The click is caught on
 * the document, so a page that swaps its body (the offline export) keeps a working switch. Storage that
 * throws (a private window, blocked site data) leaves the page following the browser.
 */
export const THEME_JS = `(function(){var k="${KEY}",d=document.documentElement;try{var t=localStorage.getItem(k);if(t==="light"||t==="dark")d.setAttribute("data-theme",t)}catch(e){}document.addEventListener("click",function(e){var b=e.target&&e.target.closest&&e.target.closest("[data-theme-toggle]");if(!b)return;var a=d.getAttribute("data-theme"),dark=a?a==="dark":matchMedia("(prefers-color-scheme: dark)").matches,n=dark?"light":"dark";d.setAttribute("data-theme",n);try{localStorage.setItem(k,n)}catch(e){}})})();`;
export const THEME_HEAD = `<script>${THEME_JS}</script>`;

/** The switch: it names the mode it changes to, so in light it says Dark mode, and in dark Light mode. */
export const THEME_BUTTON = `<button type="button" class="theme-toggle" data-theme-toggle><span class="to-dark">Dark mode</span><span class="to-light">Light mode</span></button>`;

/** The rules a dark block sits under: the browser's dark setting unless light was chosen, or dark chosen. */
export function darkRules(css: string): string {
  const scoped = (root: string) => css.replace(/(^|})\s*([^{}]+)\{/g, (_m, end: string, sel: string) => `${end}${sel.split(",").map((s) => (s.trim() === ":root" ? root : `${root} ${s.trim()}`)).join(",")}{`);
  return `@media (prefers-color-scheme: dark){${scoped(':root:not([data-theme="light"])')}}${scoped(':root[data-theme="dark"]')}`;
}

/** The switch's look and which label shows, and the browser's own controls in the chosen mode. */
export const THEME_CSS =
  `:root[data-theme="light"]{color-scheme:light}:root[data-theme="dark"]{color-scheme:dark}` +
  `.theme-toggle{font:inherit;font-size:.85em;padding:.2rem .6rem;border:1px solid currentColor;border-radius:999px;background:transparent;color:inherit;cursor:pointer}` +
  `.theme-toggle .to-light{display:none}` +
  darkRules(`.theme-toggle .to-dark{display:none}.theme-toggle .to-light{display:inline}`);
