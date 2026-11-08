# Page anatomy

The layout of a token-and-component reference. Draw every part with the
product's own tokens, type and components.

## Top to bottom

1. **Section bar.** Sticky at the top: the library's name, a link per section
   (from `SECTIONS`), and a "Copy prompt" button on the right. On phones the
   links become one row that scrolls sideways inside itself; the page never
   does.
2. **Hero.** An eyebrow (product · what this is), a one-line title that says
   what the design language is, a short lede, the Copy prompt button again,
   and the principles as a numbered grid.
3. **Sections, numbered.** Each opens with its number, title and a one-line
   lede, then its entries as cards. Each card is a specimen sheet: a small
   uppercase title, the specimens, and a footer line naming the source file.
   - **Colour.** Meaning first (if colours carry meaning), then groups of
     swatches. A swatch shows the colour in every theme, its token and value,
     and its use. Clicking it copies the token.
   - **Typography.** A row per role: the role and note on the left, a live
     sample on the right, with the class or CSS under it in mono.
   - **Spacing.** Bars drawn at each step's real size, the gutter rule, and
     the section rhythm.
   - **Radius & elevation.** Boxes at each radius and each shadow, labelled.
   - **Components.** Grouped by job. Each rendered live from its real export,
     labelled with its name and source path.
   - **Patterns.** Composed snippets made only from the parts above.
   - **Do and Don't.** Two short lists.
4. **"On this page" rail.** At wide widths, a sticky list of the entries in
   the current section, beside the content.

## Looks fine in code, wrong on screen

- **Anchors under the sticky bar.** Give every section and card a
  `scroll-margin-top` at least as tall as the bar, or links land behind it.
- **Swatches that vanish.** A colour the same as the page behind it needs a
  hairline border, or it reads as an empty box.
- **Dark-only and light-only values.** Show both, side by side, in every
  swatch. Don't rely on the viewer's theme to reveal the other.
- **Live components that overflow.** Wide components (tables, terminals, code)
  need `min-width: 0` on their grid cell and their own horizontal scroll.
- **Type specimens at phone width.** A 64px display sample needs to wrap, not
  push the page sideways; use the real responsive size.
- **Copy buttons with no fallback.** The clipboard can be blocked; select the
  text instead and say so on the button.
