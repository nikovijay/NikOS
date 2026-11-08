# ux-library

Make a component library page, and a brief for agents, from the product's
existing design system. The work is done by the `design-library` skill, which
ships in the UX pack, not in nikOS itself. This playbook checks the pack is
there, agrees the outline, and hands over to that skill's workflow.

1. Check the UX pack is installed: the `design-library` skill is in your skills list. If it isn't, tell the person to install it (Claude Code: `/plugin install nikos-ux@nikos`; Codex and Cursor: install `nikos-ux` from the nikOS marketplace), say the library can't be made until they do, and stop.
2. Make it with the `design-library` skill, following its workflow, every step in its order: find out what's real, agree the outline, write the data module, build the page from it, look at it, guard it with tests, then deliver.
3. STOP at the outline (where it lives, the sections, the principles, what's in or out) and wait for the person's yes before building.
4. Check the page: screenshots at 320, 390 and 1440 pixels wide in every theme, the Copy prompt button, and the tests passing.
5. Deliver the route, a screenshot, the brief's first lines, and the gaps that still need a decision. If the repo has an `intent/` folder, record the library's location and source of truth with `nikos decide`.
6. Report every step with its evidence or its skip reason.
