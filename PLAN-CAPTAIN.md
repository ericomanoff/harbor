# Captain Huber: expedition instructions off the gameplay

Status: plan, 2026-10-20. Changes how every expedition step is shown; no
change to level content, goals, stars or the simulator.

## 1. The problem

Expedition instructions today are the harbor master's bubble: a card that
floats next to whatever the step points at (a ship, a form, a button). It
has grown placement rules to avoid covering things (dock low during
placement, step beside panels, keep off the selection card) and still gets
in the way: F2 alone found three cases where the bubble sat on the thing
the step asked the learner to click. The instructions and the game are
fighting for the same screen.

## 2. The design

Instructions live in one fixed place, apart from the gameplay, the way an
old adventure game puts its talking character in a corner.

- **Captain Huber**, a pirate, replaces the harbor master as the voice of
  every expedition (the welcome tour keeps the harbor master: he runs the
  harbor; Huber runs the expeditions). *2026-10-23: the welcome tour moved
  to Huber too; he is the harbor master in person (PLAN-AVATAR).*
- A **dock at the bottom right**: Huber's portrait on the right, a speech
  bubble to his left pointing at him, the step's controls under the text.
  Fixed position, fixed maximum size (about 460 by 260 px at laptop widths),
  never moves with the step.
- **Nothing under the dock is needed for play.** The bottom-right corner
  holds only sea today (the right rail ends above it; the selection card is
  bottom centre). The selection card's maximum width shrinks a little so
  it never meets the dock on a 1280 px screen; below 1100 px the dock
  narrows and the portrait drops to a small badge.
- **The dock never blocks the map or the HUD**: only the bubble and
  portrait take pointer events; the rest of its region is click-through.
  The map still receives every click outside the bubble itself.
- **Pointing is done by the spotlight, not the bubble.** The existing
  spotlight (a highlighted rectangle on the target) stays and gains a
  short animated arrow from the bubble's edge toward the target when the
  target is on screen, so the learner still knows where to look without
  the text moving there.
- **Collapse**: a small chevron shrinks the dock to the portrait and the
  one-line CTA, for learners who want the map; any new step expands it
  again. Challenge mode keeps its objectives board (top centre) and shows
  no Huber.
- **Voice**: Huber speaks as a pirate captain, lightly: "Aye", "Right,
  then", "Watch the slipway". No dialect spelling, no interference with the
  Kubernetes-first wording of concepts and summaries. The level texts are
  not rewritten in this plan; only the frame changes. A later pass can
  give Huber his lines.
- **Portrait**: a CC0 pirate portrait. Kenney's Pirate Pack (already in the
  repo) has ship and tile sprites but no character portraits; options in
  order of preference: (1) Kenney "Toon Characters" or "Pirate Pack
  Extended" portrait if a CC0 one exists, (2) a composed emoji badge
  (🏴‍☠️ on a round cream badge with a hat) like the harbor master's
  🧑‍✈️ today, (3) a small original SVG drawn in the same flat style.
  Owner preference: free, CC0, no generated art, so (2) is the safe
  default and (1) replaces it if found.

Layout at 1280 by 800:

```
┌ badge ──────────── toasts ───────────── cluster panel ┐
│ rail                                          rail     │
│                     the harbor                         │
│                                                        │
│               ┌ selection card ┐       ┌ bubble ┐ (👤) │
│ Shop Charts   └────────────────┘       └────────┘      │
└────────────────────────────────────────────────────────┘
```

## 3. Changes

- `web/index.html`: `#tour` becomes `#captain` with portrait, bubble, CTA,
  hint, result, choices, dots and buttons (same data attributes so the
  specs and levels keep working); a collapse chevron.
- `web/src/tour/bubbleUI.ts`: the placement logic (anchor following, panel
  and card avoidance, placement-mode docking) is deleted; `position()`
  only updates the spotlight and the arrow. About 120 lines go away.
  Steps keep `anchor` for the spotlight; `placement` is ignored.
- `web/src/tour/tour.ts`: the welcome tour keeps using the same component
  but with the harbor master's name and face (a `speaker` option).
- `web/src/hud/hud.css`: the dock, portrait, arrow and collapse styles;
  selection card max-width 440 px.
- Level texts: anywhere a step says "the bubble" or relies on being beside
  something ("this form", "here") is reread; 1st Principles, Advanced K8s
  and the YAML campaign steps all render through the same dock.
- Glossary: a `captain-huber` entry (harbor-only) so his name gets a
  tooltip; the `harbor-master` entry notes he runs the tour and the
  harbor, Huber the expeditions.
- Tests: e2e specs that assert on `#tour .bubble .title` switch to
  `#captain`; a visual baseline of the dock on a level step; a spec
  assertion that clicking the map through the dock region (outside the
  bubble) still selects a ship.

## 4. Phases

| Phase | Scope | Size |
|---|---|---|
| H0 | **Done 2026-10-20.** `#captain` dock bottom right (bubble, tail to the portrait, emoji badge 🏴‍☠️, collapse chevron, portrait click collapses too); `BubbleUI` lost all placement logic (`position()` only drives the spotlight and a dashed arrow from the bubble edge to the target, hidden when the target is off screen, under a panel, or under the dock); the selection card shifts 200 px left while a dock is up; the welcome tour uses the same dock with the harbor master (`Speaker` option). Found on the way: the CSS block swap removed the success, summary, challenge, library, ledger and papers rules; restored from git | one session |
| H1 | Reread every step text that assumed proximity; selection card width; glossary entries; e2e and visual updates | half a session |
| H2 | Huber's voice: a pass over the 1st Principles and Advanced K8s bubbles to give him his lines (optional, owner to decide after seeing H0) | one session |

## 5. Decisions needed

1. Portrait: emoji badge now, CC0 portrait if one turns up (recommended),
   or hold H0 until a portrait is chosen.
2. Welcome tour: keep the harbor master in the same dock (recommended), or
   leave the tour on the old floating bubble.
3. H2 (Huber's lines): do it after H0 is seen, or skip and keep the neutral
   text.
