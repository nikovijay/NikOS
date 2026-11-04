# Devices and other apps

How to draw phones, keyboards and the chat apps a product lives inside.
Recreate other companies' apps closely **only when the user has said to**, and
default to leaving their logos out. Nobody should come away thinking those
companies endorse the product.

## Phone

- **Frame.** A 390×844 logical screen (iPhone 14/15) in a 12px bezel: a shell of 414×868, radius 64, #0B0B0C, with a 2px #2A2A2C inner edge and a soft drop shadow. The screen radius is 52.
- **Scale.** Draw it at 1:1 on the 1080p frame with `top: 70px`. One phone centred has `left: 753px`. For two side by side, use `left: 493px` and `left: 1013px`, which leaves the label room at the bottom right.
- **Dynamic island.** 124×36 at the top centre, radius 20, black.
- **Status bar.** 54px tall with 9:41 at the left, and signal, Wi-Fi and battery glyphs at the right, in the screen's foreground colour.
- **Home indicator.** 134×5, radius 3, 8px from the bottom: black on light screens, white on dark.
- **Overlays.** In-app browsers (sign-in pages) slide up as a sheet with a 50px top inset and a 12px top radius. Give them a "Done" bar and a centred lock plus domain, and dim the app behind to 45%.

## iOS keyboard

It's 300px tall including the home area, and slides up from below over 0.3s
(`std`). Push the composer up by the same amount while it's open, and hide
bottom tab bars.
- **Layout.** A suggestions row, then `qwertyuiop` and `asdfghjkl`, then ⇧ `zxcvbnm` ⌫, then `123` · space · `return`.
- **Keys.** 33×42 with a 5px radius, 6px gaps, and a 1px dark bottom shadow.
- **Light theme.** Background #D1D3D9, keys #FFF, special keys #ABB0BA.
- **Dark theme.** Background #2C2C2E, keys #6B6B6F, special keys #48484C.

Build it once as a function of the theme (`KB(dark)`) and reuse it.

## Chat apps (mobile, as of October 2026)

All of them have a header row at y=54 (52px tall), a message list that's
bottom-anchored above the composer, and a composer 30px from the bottom
(12px side insets).

**Grok app (xAI, dark)**
- **Colours.** Background #000, text #F2F2F2.
- **Header.** A menu icon, the model picker "Grok 4 ⌄", and a compose icon.
- **Messages.** User bubbles sit right, #242424 with radius 22, 16.5px text. Replies are plain text.
- **Tool use.** A small rounded chip on #151515 with a #2B2B2B border, e.g. "Notes · create_note".
- **Composer.** #151515 with radius 26 and an "Ask anything" placeholder. Below it: an attach icon, the "DeepSearch" and "Think" pills, and a white round send button.
- **Empty state.** A centred line such as "What's on your mind?"

**ChatGPT (light)**
- **Colours.** Background #FFF, text #0D0D0D.
- **Header.** A two-line menu icon, "ChatGPT ›" and a compose icon.
- **Messages.** User bubbles are #F4F4F4 with radius 22 and 17px text. Replies are plain 17px text.
- **Composer.** White with radius 28, a #E5E5E5 border and a soft shadow, an "Ask anything" placeholder, then +, a mic and a black round voice button.

**Claude (light, ivory)**
- **Colours.** Background #FAF9F5, text #141413.
- **Header.** A menu icon, the chat title with ⌄, and a new-chat (+) circle.
- **Messages.** User bubbles are #F0EEE6 with radius 16 and 16px text. **Replies are in a serif** (Source Serif 4 is a close open-licence stand-in) at 17px.
- **Composer.** White with radius 22 and a #E8E6DC border, a "Reply…" placeholder, + and a tools icon, and a rounded-square send button in clay (#C6613F).
