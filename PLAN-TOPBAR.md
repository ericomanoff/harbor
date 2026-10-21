# Expeditions up top, and Huber never over the card

Status: done 2026-10-20 (both parts; decisions as recommended). Two small layout changes to the HUD.

## 1. Expeditions button to the top centre

Harbor is a training tool first, so the entry to the Expeditions library
should be the most prominent control on the screen, not the fifth button
on a tool rail.

- A **big primary pill** at the top centre: `⛵ Expeditions`, styled like
  the Shop button (same size, same green), with the current expedition
  and level as a small subtitle while one is running (`1st Principles ·
  3 One door`), which doubles as a way back to the library.
- The left rail loses its Expeditions button; the rail keeps Map, Log,
  Find, Fleets, Help, Ledger, Terms.
- **Toasts move to the bottom centre** (owner's decision): they stack
  upward from just above the selection card, newest at the bottom, so an
  announcement appears next to the card it usually concerns ("Ship
  launched" above the shipyard card). When no card is open they sit above
  the Shop row. They shift left with the card while a dock is up, so Huber
  never covers them either; the same measurement in part 2 applies to the
  toast column. The top centre then holds only the Expeditions button.
- `?expeditions` and the Harbor Select overlay are unchanged; the keyboard
  shortcut E opens the library (none exists today).
- The welcome tour step that names the rail buttons is reread; the
  glossary `expedition` entry's "where" says top centre.
- Visual baselines refreshed; the tour and library specs point at the new
  button (`#hud [data-expeditions]`).

## 2. Huber's text never overlaps the selection card

Today the selection card (bottom centre) shifts 200 px left while a dock
is up. That is a fixed offset, so a wide card (a shipyard with eight
buttons is about 520 px) and the dock (440 px bubble plus the portrait)
can still meet on a 1280 px screen, and will on anything narrower.

The rule becomes **measured, not fixed**:

- On every frame tick the dock already has (`position()`), measure the
  card's and the bubble's rectangles. If they overlap horizontally with
  less than 16 px between them, move the card left by exactly the overlap
  plus 16 px (a CSS variable, so it animates). The card never crosses the
  Shop and Charts buttons on the left; if it would, step 2 applies.
- If the card cannot move far enough (narrow window, very wide card), the
  **dock collapses** to its one-line form (title, CTA, buttons), which is
  about 150 px shorter, and the card gets the room. It expands again when
  the card is dismissed or narrows.
- The same measurement keeps the dock clear of the placement hint (it is
  the same card) and of the challenge board (top centre, no conflict).
- The selection card's buttons wrap to a second row before the card grows
  past 480 px, so the common case needs no shift at all.
- A spec asserts, on the widest card we have (a shipyard: Launch, Scrap,
  Sell, Refit, Papers, Change ensign, Roll back), that the two rectangles
  do not intersect at 1280 by 760 and at 1100 by 700.

## 3. Changes

- `web/index.html`: the top-centre pill; rail button removed; the toasts
  container moves into the bottom-centre stack above the selection card.
- `web/src/hud/hud.ts`: wire the pill to `openHarborSelect`; show the
  running level in its subtitle (the runner exposes `activeLevel`).
- `web/src/hud/hud.css`: pill and toast offsets; the card's shift becomes
  `--card-shift`; the selection card wraps buttons at 480 px.
- `web/src/tour/bubbleUI.ts`: `position()` measures the card and sets
  `--card-shift` or collapses the dock; a `keepClear()` helper with a unit
  test for the arithmetic.
- `web/src/scenes/MapScene.ts`: the E shortcut.
- Tour step text, glossary "where", README, visual baselines, specs.

## 4. Phases

One session for both parts: the button first (small), then the
measurement rule and its spec.

## 5. Questions

1. **Toasts**: settled, bottom centre above the selection card.
2. **Button size**: as big as Shop (recommended, it is the main entry), or
   rail-sized?
3. **When there is no room for both**: collapse Huber to one line
   (recommended, the card is what the learner is about to click), or
   shrink the card's buttons instead?
4. **Subtitle while a level runs**: show the expedition and level under
   the button (recommended), or keep the button plain?
