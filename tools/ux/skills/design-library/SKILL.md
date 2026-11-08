---
name: design-library
description: Turn a product's existing design system into a component library page and a brief any coding agent can build from. The agent reads the real tokens, type, spacing, radii, shadows and components, puts them in one data module, renders every specimen from it (real components with fixture data, never redrawn), and adds a "Copy prompt" button that hands another agent the same rules. Use this whenever someone wants a component library, design system page, style guide, token reference, pattern library, "a page like a design system site", or a design brief or DESIGN.md for agents, from the code they already have. Also use it to update, extend or audit an existing library page.
---

# Component library pages

A component library page shows a product's design language the way the code
really has it: every colour with its token and its job, every type style,
the spacing and corner scales, and the real components rendered live. Next to
it sits a brief: the same rules as plain text, one click away, so a coding
agent can build something new that looks like it belongs.

Both come from one data module. The page renders it and the brief prints it,
so what a person sees and what an agent is told can't drift apart. Tests keep
the module honest against the source.

## Workflow

Each step exists because skipping it produces a pretty page that lies.

1. **Find out what's real.** Read before you write anything.
   - **Tokens.** Find where colours, fonts, spacing, radii and shadows are defined: CSS custom properties, a Tailwind config or `@theme` block, a theme file, design-token JSON. Record each token's name, its value in every theme (light, dark), and where it's used.
   - **Components.** List the exported UI components and the files they live in. For each, find the fixture or example data it already renders with: stories, tests, demo pages, the page that uses it most.
   - **Written rules.** Read any DESIGN.md, style guide, wiki page or lint rule about the UI. Rules that already exist become principles and do/don't lines, quoted, not reinvented.
   - **Gaps.** Note tokens that are hardcoded in places, components with no example data, and rules that the code breaks. Give these to the person; don't paper over them.

2. **Agree the outline.** Before building, give the person:
   - **Where it lives.** A route (for example `/library` or `/dev/library`), whether it's public, and whether it's behind a flag in production.
   - **The sections.** The default is Colour, Typography, Spacing, Radius & elevation, Components, Patterns, then Do and Don't. Drop a section the system doesn't have; don't fill one with guesses.
   - **Three to six principles.** One line each, drawn from step 1, that explain why the system looks the way it does.
   - **What's in or out.** Which components show, which stay internal, and any gap from step 1 that needs a decision.
   Wait for a yes.

3. **Write the data module.** One file holds everything the page and the brief show. Its shape is in `references/data-module.md`.
   - **Read values from source, don't retype them.** Import class strings and constants from the components that use them. Where a value can only be copied (a hex in CSS), a test checks the copy (step 6).
   - **Give every value its job.** A token without a "use" line teaches nothing. Write what it's for and when not to use it.
   - **Write the brief generator in the same file.** `libraryPrompt()` builds the brief from the same arrays. Its layout is in `references/agent-brief.md`.

4. **Build the page from the module.** The anatomy is in `references/page-anatomy.md`.
   - **Render real components.** Import the actual exports and pass them fixture data. Never redraw a component in the library's own markup: if it changes in code, the page must change with it.
   - **Patterns use only the parts above.** A pattern is a composed snippet, such as a hero, a card grid or a closing band, made only from tokens and components the page has already shown.
   - **Use the system on itself.** The library is drawn in its own design language, with its own tokens, type and components. If something can't be built from them, that's a gap to report.

5. **Look at it.** Code that renders isn't a page that's right.
   - **Screenshot it** at 320, 390 and 1440 pixels wide, in every theme the product has. Check there's no sideways scroll and that the swatches, type specimens and components read.
   - **Click everything.** Copy buttons, swatches that copy their token, and the section bar and rail links landing under the sticky header.
   - **Check the known failures** in `references/page-anatomy.md` ("Looks fine in code, wrong on screen").

6. **Guard it with tests.** At least:
   - Every hex, size or class the module copies matches its source (parse the CSS or config and compare).
   - Every component the module lists exists at its source path and is rendered on the page.
   - Every section and entry in the module has its anchor on the page.
   - The brief names every token and every do and don't.

7. **Deliver.** Give the person the route, a screenshot, the brief's first lines, and the gaps from step 1 that still need a decision. Commit the module, page and tests. Follow the repo's branch and PR rules.

## When the library already exists

Update the data module first, then let the page and brief follow. If the page
has values the module doesn't (hand-typed swatches, redrawn components), move
them into the module or replace them with the real export, and add the test
that would have caught it.

## Without a framework

A static site works the same way: a build script holds the data module, writes
the page's HTML with the site's own CSS classes, and embeds the brief for the
Copy button. nikos.tools/ux/library is built like this from one Node script.
