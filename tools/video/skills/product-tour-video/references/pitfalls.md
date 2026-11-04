# Pitfalls (each one happened at least once)

Read this before the first contact sheet. Most of these fail silently: the
render "works" and the frame is wrong.

## Layout and CSS

- **A child's `visibility: visible` beats a hidden parent.** If a container hides with `visibility: hidden` but a child is set to `visible` (a button you toggle), the child shows through. It turns up floating on other tabs or over closed panels. Toggle children with `display` or `opacity`, and gate tab contents on the panel being open too (`open && tab === "spec"`).
- **Descendant selectors catch nested pieces.** `.seg span { flex: 1; padding … }` also styled the tiny status dots inside each tab and stretched them into big coloured bars. Use `.seg > span`.
- **Colour inherits into overlays.** A light sign-in sheet inside a dark app screen inherited white text: invisible titles on paper. Give every overlay an explicit `color`.
- **Class names collide** when you merge a new layer into an existing page (`.screen` meant two different things). Prefix the new layer's classes, or check before you reuse a name.
- **`transform` on the window, `getBoundingClientRect` on its children.** Measure after the window is at its final size and scale, before any animation transform is applied. Otherwise every cursor target is off.
- **Text sizes.** App UI at true size (13px) is only about 17px on a 1080p frame at ×1.3. That's fine on a laptop and small on a phone-sized player. Push in when text must be read.

## Timeline

- **Everything must be a pure function of `t`.** Don't accumulate between frames, and don't use `Math.random()` (seed it if you need noise). Otherwise stills and range renders won't match the full render.
- **When you cut a stretch out of a scene, make both sides of the cut match.** The cursor must be at the same point, the camera at rest, and no state that only exists inside the cut (a confirmation that now happens elsewhere, a panel that was open).
- **A click needs the cursor already there.** Arrive at least 0.3s early, and hold through the press.

## Tooling

- **`npm i --no-save playwright` in a folder with no `package.json`** installs into the nearest ancestor that has one, often the repo root. It's harmless when `/node_modules` is gitignored and `--no-save --no-package-lock` leave the manifests alone, but check `git status`. Scripts that live outside the repo can't resolve it, so use `require.resolve("playwright", { paths: [process.cwd()] })`.
- **Don't download browsers if they're already installed.** Use `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, with a Playwright version matching the installed Chromium (chromium-1194 → playwright@1.56).
- **`while read …; do ffmpeg …` eats the loop's stdin.** Use `ffmpeg -nostdin` or a `for` loop.
- **`ffmpeg -pattern_type glob` sorts lexically,** so `still_10.jpg` comes before `still_3.jpg`. Zero-pad the file names, or use a concat list (`scripts/contact.mjs` does this).
- **Fonts come from Google Fonts,** so rendering needs the network. Wait for `document.fonts.ready` and about a second more before the first frame.

## Audio (you can't listen)

- **Check the music by its waveform and spectrogram:**
  `ffmpeg -i music/music.wav -filter_complex "showwavespic=s=1800x200" -frames:v 1 wave.png` and `showspectrumpic=s=1800x360:legend=1:scale=log:fscale=log`.
- **A flat-topped waveform with a bright band in the mids is distortion.** It happened once: a soft clipper (`tanh`) overdriven by the sub bass, whose odd harmonics landed near 700 Hz as a buzz. Normalise cleanly instead of clipping. Keep bass notes legato, overlapping by a release, so the level doesn't pump.
- **Always tell the user it was checked visually only, and ask them to listen.**

## Network and research

- **Many sites may be blocked** by the environment's network policy (CONNECT 403). Search snippets still work. When the look of an app or site matters and you can't fetch it, ask the user for screenshots instead of guessing.
- **Similar names, different products.** One company's chat app and its agent or bot app can be different products with different screens. Check which one the integration and the user actually mean.
