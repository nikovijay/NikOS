# Video pack

Make short product explainer videos from a brief, inside your AI coding agent.
The product's real screens are rebuilt in HTML, driven by a cursor or finger in
one continuous take, scored with music composed in code, and rendered frame by
frame to a 1080p MP4.

The pack is one skill, `product-tour-video`. nikOS's router sends any request
for a video to it through the `video` playbook. You can also install the pack
on its own and ask for a video directly.

## Install

Claude Code, in a session:

```
/plugin marketplace add nikovijay/NikOS
/plugin install nikos-video@nikos
```

Codex and Cursor: add `nikovijay/NikOS` as a marketplace (see
[docs/install.md](../../docs/install.md)) and install `nikos-video` from it.

Rendering also needs Node 20 or later and ffmpeg on your PATH. The skill
installs Playwright and its Chromium in the video's own folder.

## Make one

Ask your agent for a video and give it a brief:

> Make a 20-second video for my app showing how a new user adds their first task.

The agent writes the brief down, checks which screens are real, and gives you a
storyboard to approve. It then renders a 12–15 second style test for you to
approve before it builds, scores and renders the whole video to `final.mp4`.

## From your story map

If you use nikOS, your spec already knows what's built. In the repo, ask for a
video, or run:

```
npx -y nikos video --out marketing/launch
```

It drafts `brief.md` and `storyboard.js` from your constitution and the stories
marked done, one beat per activity, and leaves out anything not built yet. Once
you approve the beats, the agent renders them with the pack's storyboard
template.

## What's in it

- `skills/product-tour-video/SKILL.md`: the workflow, style and honesty rules.
- `skills/product-tour-video/assets/starter/tour.html`: a working tour to start from.
- `skills/product-tour-video/assets/storyboard/tour.html`: renders a storyboard drafted by `nikos video`.
- `skills/product-tour-video/scripts/`: `render.mjs`, `music.mjs`, `mix.mjs` and `contact.mjs`.
- `skills/product-tour-video/references/`: motion recipes, device and app details, and known pitfalls.
