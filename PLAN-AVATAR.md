# One avatar: Captain Huber is the harbor master

Status: done 2026-10-23 (all three decisions as recommended). Merges the two speakers into one and renames
two rail buttons. No change to level content, goals, stars or the
simulator; the dock's position and behaviour stay as PLAN-SWAP left them (top
right).

## 1. The problem

Two people talk to the player from the same dock: the harbor master
(🧑‍✈️) runs the welcome tour, Captain Huber (🏴‍☠️) runs every expedition.
They share one portrait slot, one bubble and one set of buttons, so the
split buys nothing and costs a second name to learn. Worse, "harbor
master" is also a glossary concept: the control plane, whose ledger is
the desired state. A speaker named after a concept muddles both.

On the left rail, two labels say less than they could: **Help** replays
the welcome tour and nothing else, and **Terms** opens the glossary,
which the panel itself and the glossary spec already call the glossary.

## 2. The design

**One speaker.** Captain Huber runs the welcome tour as well as the
expeditions. He is the harbor's harbor master, the person; the control
plane keeps the *role* ("the harbor master's ledger", "Hailing the harbor
master…", "Harbor master online") exactly as today, and the glossary says
Huber is the one who voices it.

- Name on the portrait: `Captain Huber`. Hover title on the portrait:
  `Captain Huber, harbor master`.
- **Portrait: a human face with the pirate flag kept as his badge.** The
  circle shows 🧑‍✈️ at the current 44 px (*2026-10-23: now 👨‍✈️, the man-pilot
  form, PLAN-HUBER-FACE.md*); a 🏴‍☠️ badge, about 22 px with
  the same white edge as the circle, sits on the circle's lower-right
  rim, the way every ship wears its fleet flag. One portrait for both the
  tour and the expeditions; nothing else in the dock changes.
- The welcome tour's closing step points at the Tour button and says
  "Replay this tour any time from the Tour button".
- The welcome tour's greeting stays `Ahoy, harbor master!`: Huber hails
  the player as the harbor's new master. The tour spec asserts that
  title. (Decision 2 offers a change.)

**Rail labels.**

| Button | Today | After | Attribute |
| --- | --- | --- | --- |
| 🧭 | Help, title "Welcome tour" | **Tour**, title "Welcome tour" | `data-rail=help` becomes `data-rail=tour` |
| 📖 | Terms, title "Glossary (G)" | **Glossary**, title "Glossary (G)" | `data-rail=glossary`, unchanged |

"Glossary" is the longest label on the rail; it must fit the rail
button's fixed width at the current label size. If it wraps, the rail
label size drops by one pixel for every button so the rail stays even.

## 3. Changes

- `web/src/tour/bubbleUI.ts`: one `SPEAKER` constant (`Captain Huber`,
  face 🧑‍✈️, badge 🏴‍☠️) replaces `CAPTAIN_HUBER` and `HARBOR_MASTER`; the
  `Speaker` type gains `badge`, the constructor's speaker parameter goes,
  and the portrait gets a `.badge` span filled beside `.face` and `.who`.
- `web/src/tour/tour.ts`: stops passing `HARBOR_MASTER`; the doc comment
  says Huber walks the welcome tour.
- `web/index.html`: the portrait markup gains `<span class="badge">`;
  the rail buttons read Tour and Glossary; `data-rail="help"` becomes
  `data-rail="tour"`.
- `web/src/hud/hud.css`: `#captain .portrait .badge` (absolute, lower
  right of the face, 22 px, white edge, small shadow); `#captain
  .portrait` becomes `position: relative`. Stale comments that say the
  dock is "top right" are corrected to bottom right while there.
- `web/src/hud/hud.ts`: the rail handler for the tour reads
  `[data-rail=tour]`.
- `web/src/tour/steps.ts`: the closing step's anchor selector and text
  name the Tour button.
- `web/src/glossary/terms.ts`: the `harbor-master` entry's in-harbor line
  becomes "Captain Huber voices the harbor master: he runs the welcome
  tour and the expeditions from his dock…"; the `captain-huber` entry's
  concept says he runs the welcome tour too and names the pirate flag as
  his badge.
- `web/src/levels/*.ts` and `web/src/tour/keepClear.ts`: comments that
  say "the harbor master's steps" say "Huber's steps". Level text that
  speaks of the harbor master as the control plane (level 1's ledger,
  level 5's drain) is correct as written and stays.
- `web/e2e/tour.spec.ts`: clicks `[data-rail=tour]` to replay; the
  greeting assertion stays.
- `web/e2e/visual.spec.ts`: the demo-home baseline shows the renamed
  rail, so `make test-visual-update` refreshes it; a new screenshot of
  the dock's portrait is not worth a baseline (the tour spec already
  exercises it).
- `PLAN-CAPTAIN.md`: a one-line note under its design that the welcome
  tour moved to Huber on 2026-10-23 (this plan).

## 4. Size

A short session: most of it is renames and the badge CSS; the tests are
the tour spec, the dock spec and a visual baseline refresh.

## 5. Decisions

1. The merged speaker is Captain Huber, who is the harbor master
   (recommended), or a new name for the one person.
2. The tour's greeting stays `Ahoy, harbor master!`, hailing the player
   (recommended, keeps the tour spec as is), or becomes `Ahoy, and
   welcome aboard!` so "harbor master" only ever means Huber and the
   control plane.
3. Badge: 🏴‍☠️ pinned to the portrait's rim (recommended) or the flag
   drawn on the portrait's background behind the face.
