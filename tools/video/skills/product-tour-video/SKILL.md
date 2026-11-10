---
name: product-tour-video
description: Make motion-graphics product videos in the "UI walkthrough reel" style. The product's real screens are rebuilt in HTML and driven by a visible cursor or finger in one continuous take, with Material motion (circular reveals, container transforms, cards growing into panels), slow push-ins, phone↔desktop morphs, one mono label per beat, and an original soundtrack composed in code. Everything renders frame by frame with Playwright and ffmpeg. Use this whenever someone wants an explainer, feature tour, product demo, launch or onboarding video, social clip, or "a video like this one" for a software product or app, even if they don't name the technique. Also use it to edit, re-time, extend, re-score or re-render an existing tour.
---

# Product tour videos

In this style, the product is the whole picture. The real app fills the frame
on a plain ground. A cursor (desktop) or a finger (phone) drives it through one
continuous take, and every transition is the app changing state rather than a
cut. It works because viewers see the actual product doing the actual thing,
at a pace they can follow, with one idea per beat. Nothing is mood or
decoration.

A typical cut runs 60–120s: an idea typed into an AI chat on a phone, the
first steps on mobile, up to the desktop for the main work, and back down to
the phone where the result shows up. If the repo already has a tour, build
from its scenes instead of the starter.

## Workflow

Each step exists because skipping it cost a rebuild once.

1. **Find out what's real before drawing anything.** A product video that shows features the product doesn't have is worse than no video.
   - **Research the real screens.** If your tool can run a sub-agent, give it a precise brief; otherwise do it yourself: for each screen in the story, the route or file, the layout regions, and the exact UI strings. Do the same for phone layouts (read the responsive classes) and for how each integration really behaves.
   - **List what isn't shipped.** Prototypes, flags, 404s and pricing-only features go to the user to decide on. Don't quietly include or drop them.
   - **Get references for other apps.** When the look of another app matters and you can't fetch it, ask the user for screenshots.

2. **Storyboard for sign-off.** Give the user a table of beats:

   | Time | Beat (the label) | What happens on screen |
   |---|---|---|

   - **One idea per beat**, 5–9 seconds each. The labels together should tell the whole story when read in order.
   - **Settle the decisions it raises before building.** Length, sound (music only is the default), where the video will live, what's in or out, and which third-party apps may be named or recreated, with or without logos.

3. **Style test.** Build and render the first 12–15 seconds at 1080p and send it. Motion is hard to judge from a storyboard. A short test catches a wrong feel before the whole video is built on it.

4. **Build the full tour.**
   - **Start from the engine.** Use `assets/starter/tour.html`, or the existing tour if one exists.
   - **Use the move recipes** in `references/motion-recipes.md`.
   - **Use the device and app details** in `references/devices-and-apps.md`.

5. **Look at it.** Code that runs isn't a frame that's right.
   - **Make a contact sheet.** Run `node contact.mjs sheet.png <times…>` over every beat and transition, read it, and fix what's wrong.
   - **Check the known failures.** `references/pitfalls.md` lists the ones that look fine in code and wrong on screen.
   - **Recheck after fixes.** Make a second contact sheet of the spots you fixed.

6. **Score it.** `music.mjs` composes an original track timed from the page's cues: drums while things are being built, quiet for calm beats, a resolution on the close, a tick under each click and tap, and a chime on each label. You can't hear it, so check its waveform and spectrogram (see the pitfalls), and tell the user to listen.

7. **Render, mix, check, deliver.**
   - **Render and mix.** `node render.mjs`, then `node mix.mjs`.
   - **Spot-check the encoded file.** Extract a few frames from `final.mp4` with ffmpeg and look at them.
   - **Deliver.** Send the person the file, or its path if your tool can't send files.
   - **Commit the sources only.** Outputs stay gitignored. Follow the repo's branch and PR rules.

## From a nikOS story map

In a repo with a `maps/` folder, the video can come straight from the spec,
with no screens to rebuild. `npx -y nikos video --out marketing/<name>` writes:
- `brief.md`: the product, users and problem from the constitution, and one beat per activity with done stories. Only stories marked done are in; the rest are listed as left out. Show the beats to the person and wait for their yes before rendering.
- `storyboard.js`: the same beats as data, timed.

Then render it with the storyboard template, which shows each done story and the outcomes its passing scenarios check:

```sh
cp <skill>/assets/storyboard/tour.html <skill>/scripts/*.mjs marketing/<name>/
cd marketing/<name>
npm i --prefix . --no-save --no-package-lock playwright
node contact.mjs sheet.png 2 6 10                 # look before rendering
node render.mjs && node music.mjs && node mix.mjs # → final.mp4
```

Replace the template's tokens with the product's own colours and type first.
Re-run `nikos video` whenever more stories are done; it never shows one that isn't.

## Style rules

- **Real screens, true size.** Build the app at its real CSS size and scale the window for 1080p: 1240×680 at ×1.3 becomes 1612×884 at (154, 56). Phones are 390×844 at 1:1. Use the product's own tokens, type and copy; read its design doc first.
- **One continuous take.** Move between pages with a shared-axis cross-fade. "This opens that" gets a circular reveal from the tap. A card grows into its panel, and the phone screen morphs into the desktop window and back. Allow a hard cut only where the story jumps in time, and prefer a time-lapse inside the UI.
- **Material timing.** Use the standard curve (0.4, 0, 0.2, 1) for moves and decelerate (0, 0, 0.2, 1) for arrivals, with transitions of 0.3–0.9s. Overshoot is only for small status pops.
- **A hand on the product.** On desktop, an arrow cursor arrives at least 0.3s before the click, holds, presses (scale 0.86) and ripples. On a phone, a finger dot does the same, and app switches are swipes along the home bar.
- **Push in where the reading happens,** ×1.25–1.35, eased in, held, then eased out. Pull back for overviews.
- **Labels carry the story when it's muted.** One per beat, numbered: mono, uppercase, the number in the accent colour, bottom right. 2–9 words, and the text appears whole, never typed on.
- **Typing and streaming.** About 30 characters a second for typing, with a caret and a focus ring. AI replies stream word by word. The keyboard rises when typing on a phone.
- **Colour means something.** Use status colours as the product does. Show a state change by colour, word and a small scale bump together, so it reads without sound.
- **Close on the brand.** The brand's one plate colour opens as a circle from the last tap, then a serif statement line, the URL and the install command. Hold it for 5–7s.

## Honesty rules

- **Only what's real.** Show shipped behaviour, or what the user explicitly approves as "being built". Use real UI copy, real commands and real tool names.
- **Show a failure.** One test failing and then being fixed is more convincing than all green.
- **No invented proof.** No stats, customers, testimonials, logos or quotes. Sample data is labelled as an example project.
- **Other companies' apps.** Recreate them closely only with the user's say-so, without logos by default, and never imply endorsement.
- **Check each host.** Draw each integration as it really renders: a card in one host, text only in another, for example.

## The engine

`assets/starter/tour.html` is a small working tour covering a phone tap, a card
expanding into its detail, the phone-to-desktop morph, a cursor click with a
ripple, a push-in, typing, labels and the plate close. Copy it and replace its
demo screens.
- **Persistent DOM.** One DOM, built once. `window.renderAt(t)` sets every style from `t` alone, so any frame renders on its own, which is what makes stills, ranges and re-timing reliable.
- **Measure once.** `measure()` runs on the first frame, after fonts load, with everything at rest. It records cursor targets in frame pixels.
- **Timeline as data.** One object of times (`P`), plus lists: screens (on/off ranges), cursor keyframes, clicks, camera keys, taps, labels.
- **Reuse a scene.** To drop an existing scene into a longer story, give it its own clock and map global time to it piecewise (recipe 12).
- **The page contract the scripts read:**
  - `window.renderAt(t)` and `window.TOTAL` (seconds) for `render.mjs` and `contact.mjs`;
  - `window.CLICK_TIMES` and `window.LABEL_TIMES` (arrays of seconds) and `window.END_AT` (the close) for `music.mjs`;
  - optionally `window.MUSIC = { arpIn, bassIn, drums: [[from, to], …], end }`.

## Commands

Put the video in its own folder, e.g. `marketing/<name>/`, and copy the
scripts next to the page:

```sh
cp <skill>/assets/starter/tour.html <skill>/scripts/*.mjs marketing/<name>/
printf 'music/\nvideo.mp4\nfinal.mp4\nstill_*.jpg\nnode_modules/\n' > marketing/<name>/.gitignore
cd marketing/<name>
npm i --no-save --no-package-lock playwright
npx playwright install chromium           # once per machine; ffmpeg must be on PATH too
node contact.mjs sheet.png 1 3 5 8        # look before rendering
node render.mjs range 0 15                # style test → video.mp4
node render.mjs                           # the whole tour → video.mp4 (about 1.3s of wall time per second of video)
node music.mjs                            # → music/music.wav
node mix.mjs                              # → final.mp4
```

Render long tours in the background if your tool can, and commit while they
run.

## References

- `references/motion-recipes.md`: code for each move (cursor, taps, swipes, push-ins, reveals, container transforms, state changes, terminals, nested clocks, the close).
- `references/devices-and-apps.md`: the phone frame, status bar, iOS keyboard, and the Grok, ChatGPT and Claude mobile shells.
- `references/pitfalls.md`: the bugs that look fine in code, the tooling traps, and how to check audio without hearing it.
