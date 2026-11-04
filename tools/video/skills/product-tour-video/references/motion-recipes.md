# Motion recipes

Each move as the small piece of code that makes it. Everything here is a pure
function of `t` (seconds): compute the value from the timeline, set the style,
never accumulate state between frames. That's what lets any frame render on
its own, so stills, ranges and re-timing all just work.

The starter (`assets/starter/tour.html`) has the helpers; search it for the
names used here.

## Contents
1. Easing and windows
2. Typing, streaming, spinners
3. Cursor, clicks and ripples
4. Finger taps and swipes (phone)
5. Camera push-ins
6. Screen changes (shared axis)
7. Circular reveal
8. Container transform: card → panel, phone → desktop
9. State changes that read
10. Lists that grow, pages that scroll
11. A terminal that prints
12. Nested clocks: reuse a scene, cut a stretch
13. The close

## 1. Easing and windows

```js
const std = bezier(0.4, 0, 0.2, 1); // Material standard: anything that moves from A to B
const dec = bezier(0, 0, 0.2, 1);   // Material decelerate: things arriving on screen
const back = (x) => { /* small overshoot */ };   // only for little "pops" (a badge, a status bump)
const span = (t, s, d) => clamp((t - s) / d);    // 0→1 over [s, s+d]
const shown = (t, a, b, d = 0.3) => Math.min(span(t, a, d), 1 - span(t, b, d)); // fade in at a, out at b
const during = (t, ranges, d) => Math.max(0, ...ranges.map(([a, b]) => shown(t, a, b, d)));
```

Use `std` for moves, `dec` for arrivals. Keep `back` for one-off pops. A whole
UI that bounces looks cheap.

## 2. Typing, streaming, spinners

```js
const typeOut = (text, t, from, dur) => text.slice(0, Math.round(text.length * clamp((t - from) / dur)));
const words = (text, t, a, b) => { const w = text.split(" "); return w.slice(0, Math.round(w.length * clamp((t - a) / (b - a)))).join(" "); };
```

- **Typing.** People type at about 30 characters a second on video. That's faster than real life, and it reads as natural. Show a caret that's solid while typing and blinks otherwise: `Math.floor(t * 2.4) % 2`. Give the field a focus ring (accent border plus a 3px ring at 22%).
- **AI replies.** They stream word by word with `words()`. Labels and headings appear whole.
- **Spinners.** Use `rotate(${t * 420}deg)`, or cycle the braille glyphs `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` with `SPIN[Math.floor(t * 12) % 10]` in a terminal.

## 3. Cursor, clicks and ripples

The cursor is an SVG arrow in frame pixels, inside the camera, so it zooms with
push-ins. Keyframes are `[t, x, y]`, and `along()` eases between them with
`std`:

```js
const K = [[3.0, 1240, 900], [3.2, 1240, 900], [3.9, M.ta.x, M.ta.y], [6.2, M.ta.x, M.ta.y], ...];
```

How a click should read:
- **Arrive early.** The cursor reaches the target at least 0.3s before the click.
- **Hold.** It stays still through the click.
- **Press.** The cursor scales to 0.86 and the button to 0.95–0.97 for 0.12s.
- **Ripple.** A circle of the accent colour at 28% grows from 6 to 34px over 0.45s while it fades.

Keep `clicks()` in the same coordinates as the keys. Expose their times
(`window.CLICK_TIMES`) so the music can put a tick under each one.

Measure the targets once, after fonts load, with the window at rest:
`getBoundingClientRect()` centres in frame pixels. If an element only exists in
one state (a menu, a chip that slides in), force it laid out during `measure()`
(for example `maxWidth: none`), measure it, and let the render set it back.

## 4. Finger taps and swipes (phone)

On a phone, show a finger, not an arrow. Use a 48px circle: white at 50%, a 2px
ink border at 38%, and a soft shadow.
- **Taps.** The dot appears 0.28s before the tap, scales to 0.82 for 0.12s at the tap, and fades out after.
- **Positions.** Read them live with `getBoundingClientRect()` each frame. Phone layouts shift as messages arrive and keyboards rise, so a position measured once goes stale.
- **Switching apps.** Swipe along the home bar, as iOS does. Lay the apps' screens side by side in a strip, translate it by −390px per app with `std`, dip its scale by about 6% mid-swipe (`1 - 0.06 * sin(π p)`), and drag the dot along the bottom edge.

## 5. Camera push-ins

The `#cam` wrapper takes
`translate(960 - s·fx, 540 - s·fy) scale(s)`. Keyframes are
`[start, duration, scale, fx, fy]`, each easing from the previous value:

```js
const K = [[3.9, 0.9, 1.32, M.q.x, M.q.y], [6.75, 0.8, 1, 960, 540], ...];
```

- **When.** Push in ×1.25–1.35 on whatever the eye should read: a form being typed into, a list filling in, a dialog.
- **Timing.** Ease in over about 0.9s, hold while it plays, ease out over 0.7s before the next move.
- **Overviews.** Pull back to ×0.9 when showing the whole picture.
- **What to leave alone.** Don't push in when two far-apart things both matter, like a terminal on the left and a panel on the right. One of them falls out of frame.

## 6. Screen changes (shared axis)

When moving between pages of the same app, cross-fade with a 14px slide. Run
the old page's fade-out and the new page's fade-in over the same 0.3s window:

```js
const o = during(t, SCREENS.list);  // SCREENS = { list: [[a, b], ...], detail: [[a, b]] }
put(el, { opacity: o, visibility: o > 0 ? "visible" : "hidden", transform: `translateX(${lerp(14, 0, o)}px)` });
```

Update the header's active tab at the same moment.

## 7. Circular reveal

This is the reference reel's signature move. The next view grows as a circle
from the point that was clicked:

```js
put(next, { visibility: t >= T0 ? "visible" : "hidden",
  clipPath: p >= 1 ? "none" : `circle(${lerp(0, 1500, std(p))}px at ${cx}px ${cy}px)` });
```

Use it for "this opens that": a button that generates something, a link
opening another app, the final brand plate. Express `cx`/`cy` in the revealed
element's own coordinates (the tap point minus the element's top-left). Clear
`clipPath` to `none` once it's done.

## 8. Container transform: card → panel, phone → desktop

A shape morphs from where something was to where it will be, and the content
cross-fades across it.

- **Card → panel.** A ghost div goes from the card's rect to the panel's rect over 0.55s (`std`):
  - Lerp its position, size and radius (6 → 0), and grow its shadow.
  - Tint it from the card's status colour to white.
  - Put a copy of the card's content inside it and fade that out over the first 40%.
  - Show the real panel as the ghost finishes, and stagger its sections in at about 0.13s each.
- **Phone → desktop.** A `#morph` rect goes from the phone screen's rect (radius 52) to the desktop window's rect (radius about 10):
  - The phone and its bezel fade out over the first 0.3s.
  - The desktop fades in over the last 0.4s, above the morph.
  - Run it in reverse to come back down, then fade the phone in over the morph's last frames.

## 9. State changes that read

A status change should be obvious without sound:
- **Colour.** Switch the tint and border colours.
- **Bump.** Scale from `lerp(1.05, 1, back(span(t, at, 0.4)))`.
- **Words.** Change the status text itself.
- **Edges.** In-progress items get an inset left edge (`inset 4px 0 0 <green>`).
- **Live.** Pulse a "live" dot's opacity with `0.45 + 0.55·|sin(2.6t)|`.
- **Same thing in two places.** Glow the shared ID on both (a 3px ring at 35%) each time it lands.

## 10. Lists that grow, pages that scroll

- **Growing rows.** A new row in an existing list animates `height`, padding and opacity from 0. Measure its full height first, then highlight it with the accent at 7% fading over about 1.2s.
- **Scrolling.** Translate the page content by `-scroll * std(p)`. Compute the scroll at measure time so the target card ends 24px above the fold.
- **Chat threads.** Anchor them to the bottom with `display:flex; flex-direction:column; justify-content:flex-end; overflow:hidden`. New messages push the old ones up and off the top, which is how a chat looks scrolling.

## 11. A terminal that prints

Keep a list of `{ t, html }` lines, plus `{ t, type, dur }` for typed commands
and `{ t, spin, until, done }` for "working…" lines that resolve to a ✓. Each
frame, collect the lines whose `t` has passed and show the last ten:

```js
$("tty").innerHTML = lines.slice(-10).join("\n");
```

Use real commands and real tool names only. A failing line in red, then a
fixed one, is more convincing than an all-green run.

## 12. Nested clocks: reuse a scene, cut a stretch

When a finished scene needs to sit inside a bigger story, give it its own clock
instead of re-timing it:
- **Wrap it.** Turn its `renderAt` into `renderScene(td)`.
- **Map the clocks.** Write a piecewise map from global time to scene time:

```js
const SEGS = [[37.4, 66.9, 10.9], [66.9, 74.4, 48.4]]; // [global from, global to, scene from]
const tdOf = (t) => { for (const [a, b, d] of SEGS) if (t < b) return d + (t - a); return last; };
```

- **Cut a stretch.** Two segments that jump in scene time drop the stretch between them.
- **Keep the cut invisible.** Make the frames on either side match: hold the cursor at the same point, keep the camera at rest, and remove any state that only happens inside the cut.
- **Scale back.** Map the scene's click times back to global time (`gOf`) for the music.

## 13. The close

Close on the brand's one plate colour, opening as a circle from the last
meaningful tap. The logo, a serif statement line and the mono URL and command
arrive one by one, about 0.35s apart, from 1.0s after the reveal starts. Hold
it for 5–7s so it works as a still and the music can resolve.
