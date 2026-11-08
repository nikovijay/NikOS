# The data module

One file, next to the components it describes. The page imports it, the brief
prints it, and the tests check it. Keep the names below so the page anatomy
and the brief template line up; add fields when the system needs them.

```ts
// library-data.ts: the design language, as data. Feeds the library page
// and the Copy prompt brief, so the two can't drift apart. Values are read
// from source where possible; tests check the ones that are copied.

export interface Entry { id: string; title: string }
export interface Section extends Entry { nav: string; entries: readonly Entry[] }

/** The section bar, the "On this page" rail and the page all read this. */
export const SECTIONS: readonly Section[] = [
  { id: "colour", nav: "Colour", title: "Colour", entries: [
    { id: "colour-meaning", title: "What colour means" },
    { id: "colour-surfaces", title: "Surfaces" },
    { id: "colour-text", title: "Ink and text" },
  ] },
  // typography, spacing, shape, components, patterns, rules …
];

/** Why it looks like this. Three to six, one line each. */
export const PRINCIPLES = [{ title: "…", body: "…" }];

/** Tokens in groups, each with its value in every theme and its job. */
export const COLOUR_GROUPS = [
  { id: "colour-surfaces", title: "Surfaces", pattern: "--bg, --surface", tokens: [
    { token: "--bg", name: "Paper", light: "#f2f3ef", dark: "#0d100e", use: "The page. Never on a card." },
  ] },
];

/** Colours that carry a meaning, if the system has any (status, brand, intent). */
export const COLOUR_MEANING = [{ word: "Done", token: "--accent", means: "…" }];

/** One row per type role: what it's for and the exact class or CSS that makes it. */
export const TYPE_SPECIMENS = [{ id: "type-display", role: "Display", css: "…", sample: "…", note: "…" }];

export const SPACING = [{ step: "…", px: 16, seen: "where it's used" }];
export const GUTTERS = [{ name: "wrap", css: "…", use: "…" }];
export const RADII = [{ token: "--radius", px: 14, use: "…" }];
export const SHADOWS = [{ name: "…", css: "…", use: "…" }];

/** The real exports, by source file. The page renders each one with fixture data. */
export const COMPONENTS = [{ group: "Actions", name: "Button", source: "src/components/button.tsx" }];

export const DOS = ["…"];
export const DONTS = ["…"];

/** The brief for agents, built from the arrays above. */
export function libraryPrompt(): string { /* see agent-brief.md */ }
```

## Rules

- **Import, don't retype.** If a component exports its class string, size or
  constant, import it. Copy a value only when there is nothing to import, and
  then test the copy.
- **Every theme, every value.** A token with a dark value lists both. A page
  that only shows light mode hides half the system.
- **Plain words in `use`.** "Cards and panels on the page" beats "surface-1".
  Say when not to use it, too.
- **No invented tokens.** If the code uses a raw hex in five places, report
  it as a gap; don't name it in the module as if it were a token.
