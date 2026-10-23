# Captain Huber, always on deck

Status: done 2026-10-23. Most of part one landed through the other
session's PLAN-AVATAR.md and PLAN-SETTINGS.md the same day (the portrait is
always on the HUD top right with Tour and Expeditions buttons under it; the
zoom rail folded into Settings on the left rail), so this plan's remainder
was: the portrait itself opens the library (the chevron is the only
collapse), the bubble's cap is everything between the portrait block and
the bottom-right stack (`calc(100vh - dock top - 150px)`, about 440 px on
760 with the level name showing), and the text is 14 px / 1.5 with a 19 px
title. The idle greeting bubble was dropped: the two buttons under him do
that job. Builds on PLAN-SWAP.md.

## 1. The problem

Captain Huber appears only while a level runs; with no level there is an
empty top-right corner and a green "Expeditions" pill at the top centre.
Learners look for the character, not the pill: the person who gives the
lessons should be the thing you click to get one. And his bubble, capped
at min(66vh, 100vh - 320px) so it clears the zoom rail and the cluster
panel beneath it, is about 440 px tall on a 760 px window, with 13 px
text: readable, not comfortable.

## 2. The design

**Huber is always at the top right.**

- His portrait and name are on screen from the moment the harbor loads,
  with or without an expedition, in Open Harbor and on a real cluster.
- **Clicking the portrait opens Harbor Select** (the expeditions library),
  always: idle, mid-level, in challenge mode. The chevron on the bubble
  is the only collapse control (today the portrait also collapses).
- **Idle, he has a one-line bubble**: "Ahoy. Ready for an expedition?"
  with a single **Expeditions** button. The chevron folds it to nothing
  but the portrait, and that choice is remembered (localStorage), so a
  learner who is here to run their cluster sees only the small portrait.
  Any lesson he starts re-opens the bubble.
- **While a level runs** the bubble is the step, as now, with a new
  eyebrow line above the title naming where you are: `1ST PRINCIPLES ·
  LEVEL 4`, in the place the Expeditions pill's subtitle used to be.
- **The Expeditions pill at the top centre goes.** Huber is the one entry
  (plus the E key and `?expeditions`). The top centre is free for the
  challenge board, which moves up to the top edge.
- The welcome tour runs in the same dock with the same portrait (the tree
  now has a single speaker, Captain Huber as harbor master; the plan keeps
  whatever that work lands).
- Challenge mode keeps its no-bubble rule: the portrait stays, the bubble
  is hidden, clicking him opens the library (leaving the challenge is a
  choice in the library, as today).

**The bubble is taller and the text bigger.**

- The zoom rail (settings, zoom in, home, zoom out, sound) leaves the
  bottom right and becomes a **row at the top right, beside the portrait**
  (left of it, same 12 px top line), so nothing but the cluster panel sits
  under the bubble. The row is 5 buttons, 260 px, and ends well short of
  the Expeditions-free top centre.
- The bubble's cap becomes **everything between the portrait and the
  cluster panel**: `max-height: calc(100vh - 210px)`. That is 550 px on a
  760 px window (72%), 490 px on 700, 390 px on 600. Short steps stay
  short (the cap is a maximum, the bubble fits its content); long steps
  grow before they scroll.
- **Text at 14 px with line-height 1.5** (from 13 px and 1.4), the title
  at 19 px, the CTA line at 13 px. Choice pills and the Hint, Skip, Back,
  Next buttons are unchanged. Twelve lines of a dense principle step fit
  on a 700 px window without scrolling.
- The folded (collapsed) bubble is unchanged: title, CTA, buttons.

Layout at 1280 by 760:

```
┌ badge ──────────────────────── ⚙ ＋ ⌂ － 🔕  (portrait) ┐
│ rail                                        Huber       │
│                   the harbor               ┌ bubble ─┐  │
│                                            │ 1ST PR… │  │
│                                            │ title   │  │
│                                            │ text …  │  │
│                                            │ buttons │  │
│                                            └─────────┘  │
│               toasts                                    │
│ Shop Charts   ┌ selection card ┐   ┌ HEALTH / CAPACITY ┐│
└─────────────────────────────────────────────────────────┘
```

## 3. Changes

- `web/index.html`: the `data-expeditions` pill is removed; `.hud-right-rail`
  moves to a `.hud-top-right` row (right: 112px, beside the portrait);
  the bubble gains an `.eyebrow` line; `#captain` is no longer `hidden`
  by default; an idle `.bubble.idle` variant (text + one button).
- `web/src/tour/bubbleUI.ts`: a persistent `CaptainDock` owns the portrait
  and the idle bubble; the level and tour runners borrow it to show steps
  (today each `BubbleUI` builds and tears down the dock). The portrait's
  click handler opens Harbor Select; the chevron collapses; the idle fold
  is remembered under `harbor.huber.idle`.
- `web/src/hud/hud.ts`: the subtitle code that fed the pill writes the
  bubble's eyebrow instead.
- `web/src/scenes/MapScene.ts`: the pill's click listener goes; E and
  `?expeditions` stay.
- `web/src/hud/hud.css`: rail row top right; bubble cap `calc(100vh - 210px)`;
  text 14 px / 1.5; eyebrow; idle bubble; `#challenge { top: 12px }`;
  `.hud-bottom-right` holds only the cluster panel.
- Text: welcome tour "rails" step (names Huber as the way to the
  expeditions; the zoom row top right), glossary `expedition` "where"
  ("Captain Huber, top right, or E") and `captain-huber` entry, README.
- Specs: `dock.spec.ts` (portrait click opens the library with no level
  running; the bubble is at least 70% of a 760 px window on a long step;
  the rail row and the bubble do not meet), `tour.spec.ts`/`levels.spec.ts`
  wherever they click `[data-expeditions]` (they open the library by the
  portrait instead); visual baselines refreshed.

## 4. Size

One session.

## 5. Questions

1. **The Expeditions pill**: remove it (recommended: one entry, and Huber
   is it), or keep it as well as the portrait?
2. **Idle bubble**: a one-line greeting with an Expeditions button that
   can be folded away and stays folded (recommended), or the portrait
   alone with no idle bubble?
3. **Zoom rail**: a row beside the portrait at the top right (recommended;
   it is what frees the height), or a row under the badge at the top left?
