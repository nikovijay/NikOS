# video

Make a short product explainer video from a brief. The work is done by the
`product-tour-video` skill, which ships in the Video pack, not in nikOS
itself. This playbook checks the pack is there, pins down the brief, and
hands over to that skill's workflow.

1. Check the Video pack is installed: the `product-tour-video` skill is in your skills list. If it isn't, tell the person to install it (Claude Code: `/plugin install nikos-video@nikos`; Codex and Cursor: install `nikos-video` from the nikOS marketplace), say the video can't be made until they do, and stop.
2. Write the brief down before anything else. If the repo has an `intent/` folder with done stories, run `nikos video --out marketing/<name>`: it drafts `brief.md` and `storyboard.js` from `intent/constitution.md` and the stories marked done, one beat per activity, and leaves out everything not built yet. Otherwise write the product, who the video is for, its length, where it will live, the story it tells in one line, and what's in or out. Ask for anything missing.
3. Make it with the `product-tour-video` skill. From a drafted storyboard, render its storyboard template (the skill's "From a nikOS story map" section). For a tour of the product's real screens, follow the skill's workflow, every step in its order: find out what's real, storyboard for sign-off, the style test, the full build, the contact sheet, the score, then render and mix.
4. STOP at the storyboard (the beats in `brief.md`, or the skill's storyboard table) and, for a screen tour, again at the style test, and wait for the person's yes each time. A yes to one isn't a yes to the other.
5. Check the encoded `final.mp4`: extract a few frames with ffmpeg and look at them, and give its length and size.
6. Deliver `final.mp4` with the brief it was made from. Commit the video's sources only; the rendered files stay ignored.
7. Report every step with its evidence or its skip reason.
