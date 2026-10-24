# Captain Huber is a man

Status: done 2026-10-23 (emoji, as recommended). A one-line change to the
portrait; the drawn alternative below is still available.

## 1. The problem

The portrait circle shows 🧑‍✈️, the gender-neutral "pilot" emoji, under
the pirate-flag badge. The captain is written as a man everywhere else
("he", "his bubble", "Captain Huber, harbor master"); the face should
match.

## 2. The design

**Swap the face for the man-pilot emoji 👨‍✈️.** It is the same emoji
family in a male form: a man in a peaked cap, so he still reads as the
one in charge of the harbor. The badge, the circle, the name and the
hover title are unchanged. Two places carry the glyph: the HUD markup
and the `CAPTAIN_HUBER` speaker constant. No text changes: the welcome
tour, the glossary and the README already use "he".

Rendering: the glyph comes from the platform's emoji font. On macOS and
iOS it is a man with a cap; on Windows and Android it is a man with a
cap in each vendor's style; in the headless Chromium the e2e and visual
suites use, it renders from whatever emoji font the machine has (the
visual baseline is per machine already).

**If the emoji is not the captain wanted** (too young, no beard, no
sea in him), the alternative is a **drawn portrait**: an inline SVG in
the circle, drawn by hand in code like the fleet flag and the readiness
bar: a bearded man in a dark peaked cap with an anchor badge, navy coat,
white collar, in the flat style of the Kenney pirate sprites. No art
generation and no new asset licence; the SVG is ours. It renders the
same on every machine, which the emoji does not. It is a half-day of
drawing versus a one-character change.

## 3. Changes

- `web/index.html`: the `.face` span shows 👨‍✈️.
- `web/src/tour/bubbleUI.ts`: `CAPTAIN_HUBER.face` is 👨‍✈️.
- `web/e2e/visual.spec.ts-snapshots/demo-home-darwin.png`: refreshed (the
  portrait is in the frame).
- `PLAN-AVATAR.md`: a note that the face became the man-pilot emoji.
- Drawn alternative, if chosen: `web/src/hud/portrait.svg` inlined into
  the `.face` span (the span's font-size no longer matters), plus the
  speaker constant pointing at the SVG rather than a glyph.

## 4. Size

Fifteen minutes for the emoji; half a day for the drawn portrait.

## 5. Decision

Emoji 👨‍✈️ (recommended: cheap, consistent with the rest of the HUD's
emoji glyphs) or the drawn SVG captain?
