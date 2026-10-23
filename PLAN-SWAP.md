# Instructions top right, health panel bottom

Status: done 2026-10-23 (all three decisions as recommended). Swaps two HUD
regions and gives Captain Huber room to be read. One deviation from the
design below: the right rail became a **row** above the cluster panel
(five buttons in a column plus the panel do not fit in the bottom third of
a 760 px window), and the panel's room-fold stacks the HEALTH chips in a
column, since the HEALTH row alone was as wide as the whole panel.

## 1. The problem

Captain Huber's bubble is a 440 px card at the bottom right with its text
capped at 150 px and scrolling. Level 4's first step already scrolls, and
the Kubernetes-first wording of the principle levels is dense. The health
and capacity panel, meanwhile, holds the prime top-right spot for numbers
nobody reads mid-lesson.

## 2. The design

**Captain Huber moves to the top right and grows tall.**

- The dock becomes a **column** anchored to the top-right corner: the
  portrait at the top with his name under it, the speech bubble below it
  with its tail pointing up at him, the step's buttons at the bottom of
  the bubble.
- The bubble is **440 px wide and up to two thirds of the window tall**
  (`max-height: 66vh`), with the text area taking whatever the title, CTA,
  hint, result, choices and buttons leave. Text scrolls only past that;
  at 760 px tall that is roughly 350 px of text, more than any step uses.
- The right rail (zoom, home, settings, sound) sits in the dock's column;
  it moves to the **right edge, bottom third**, under the bubble, so the
  two never meet. The Shop and Charts buttons stay bottom left.
- The collapse chevron and portrait click still fold the bubble to its
  one-line form; folded, the dock is a small card under the portrait.
- The arrow now starts from the bubble's bottom or left edge, whichever
  faces the target; the spotlight is unchanged.
- The measured `keepClear` rule that slid the selection card left is no
  longer needed for the card (it is at the bottom centre, the dock is at
  the top right); it is reused for the **cluster panel**, which the dock
  does displace (part 3).

**The health and capacity panel moves to the bottom.**

- It sits **bottom right**, where the dock was: same card, same two rows
  (HEALTH, CAPACITY), right-aligned.
- The selection card stays bottom centre; its right edge and the panel's
  left edge are kept apart by the existing `--card-shift` measurement,
  now measuring the panel instead of the dock, so a wide card still never
  touches it. When even that cannot fit (narrow window), the panel folds
  to one row showing only HEALTH, since capacity is the less urgent pair.
- Toasts stay in the bottom-centre column above the card.

Layout at 1280 by 760:

```
┌ badge ─────────── Expeditions ──────────── (portrait) ─┐
│ rail                                        Huber      │
│                   the harbor                 bubble    │
│                                              …         │
│                                             zoom rail  │
│               toasts                                   │
│ Shop Charts   ┌ selection card ┐   ┌ HEALTH / CAPACITY ┐│
└───────────────────────────────────────────────────────┘
```

## 3. What else moves

- **The cluster panel is gone from the top right**, so the Expeditions
  button and toasts have the centre to themselves and the `max-width:
  1200px` nudge that kept the button off the panel is removed.
- **Challenge mode's objectives board** (top centre, below the Expeditions
  button) is unchanged; no Huber in challenge mode.
- **Forms and panels**: today the dock folds and drops under overlays, and
  overlays shift 140 px left. With the dock at the top right, overlays
  are centred again and the bubble stays readable beside a form (a form is
  at most 420 px wide, centred, the bubble is 440 px at the right edge:
  they clear on 1280 px). Wide panels (Papers, the library, the summary)
  still cover the dock and still win; the dock folds under them as now.
- The welcome tour uses the same dock, top right, with the harbor master.

## 4. Changes

- `web/index.html`: the dock's children reorder (portrait first); the
  cluster panel moves into `.hud-bottom-right`; the right rail keeps its
  markup.
- `web/src/hud/hud.css`: `#captain .dock` top/right, column, tail up;
  bubble `max-height: 66vh` with the text as the flexible part; right rail
  `top: auto; bottom: 110px`; `.hud-bottom-right` for the panel; the
  modal rules drop the 140 px overlay shift; the 1200 px nudge goes.
- `web/src/tour/bubbleUI.ts`: `keepCardClear()` measures the cluster panel
  against the card instead of the dock; the room-fold now folds the
  panel's CAPACITY row (a class on the panel) rather than the dock; the
  arrow's start point picks the bubble's bottom or left edge.
- `web/src/tour/keepClear.ts`: unchanged arithmetic; the caller passes the
  panel's left edge.
- `e2e/dock.spec.ts`: asserts the bubble is top right and at least 50% of
  the window tall on a long step, the panel is bottom right, and the card
  and panel stay apart at 1280 by 760 and 1100 by 700.
- Tour step text ("the cluster panel, top right" becomes "bottom right"),
  glossary `where` lines for berths and cargo, README, visual baselines.

## 5. Size

One session.

## 6. Questions

1. **Right rail**: move it down under the bubble (recommended), or to the
   left rail's column so the whole right edge belongs to Huber?
2. **Panel fold on narrow windows**: fold CAPACITY away (recommended, the
   HEALTH chips are the ones lessons point at), or shrink the selection
   card's buttons instead?
3. **Bubble height**: two thirds of the window as asked, or cap it at the
   content so short steps stay small (recommended: cap at content with a
   66vh maximum, so a three-line step is a short bubble and a long one
   grows; the bubble's top stays fixed either way)?
