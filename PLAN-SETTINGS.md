# One Settings button on the left rail

Status: done 2026-10-23. Removes the right rail; its five buttons move
behind a single Settings button at the bottom of the left rail. No change
to what any of them does.

## 1. The problem

The right rail (settings, zoom in, home, zoom out, sound) sits as a row
above the cluster panel at the bottom right, where PLAN-SWAP parked it
after Captain Huber took the top-right corner. It is five more buttons on
a screen that already has a seven-button rail on the left, and it crowds
the one corner the cluster panel needs. Two of its five are already
reachable elsewhere: the wheel zooms, H goes home, M toggles sound, and
the Settings overlay has its own Sound toggle. The rail earns little.

## 2. The design

**One button.** The left rail gains an eighth button under Glossary:
⚙️ **Settings**, same 48 px style, `data-rail="settings"`. The
`.hud-right-rail` element goes; the cluster panel keeps the bottom-right
corner alone.

**Settings is a popover, not a modal.** Clicking the button opens a small
cream card anchored just right of the rail, level with the button, with
no dimmed backdrop. It closes on Escape, on a click anywhere outside it,
or on the button again. The map stays live behind it, so the view
controls inside it act at once:

```
┌ SETTINGS ───────────────────────────┐
│ VIEW        [ ＋ ]  [ ⌂ ]  [ － ]   │   zoom in · whole harbor · zoom out
│ Sound: on            🔔             │   toggles, glyph follows
│ Both languages: off                 │
│ System fleets: hidden               │
│ ─────────────────────────────────── │
│ Sail to another harbor…             │   these three close the popover
│ Fleets filter…                      │
│ Chart libraries…                    │
└─────────────────────────────────────┘
```

- The VIEW row holds the three former rail buttons as small square
  buttons; each acts on the map and leaves the popover open. Their titles
  carry the keys: `Zoom in (+)`, `Whole harbor (H)`, `Zoom out (−)`.
- Sound, Both languages and System fleets stay the toggles they are,
  with the sound glyph (🔔 / 🔕) shown on the row, so the state the rail
  used to show is still visible once Settings is open.
- Sail to another harbor, Fleets filter and Chart libraries open their
  own overlays and close the popover first, as the modal does today.
- The popover does not set the modal flag (keys and the map keep
  working); it is a plain HUD card with `pointer-events: auto`. Opening
  it while a modal overlay is up is not possible, since the HUD rail is
  under the overlay's backdrop.

**Keyboard.** `+` and `=` zoom in, `-` zooms out, at the same factors the
buttons use (1.25 and 0.8). H stays home, M stays sound. The welcome
tour's "Around the harbor" step lists `+ − zoom` with the other keys.

**Markup moves, ids stay.** The `#settings` overlay element is reused as
the popover (same `data-set` hooks, same `openSettings()` wiring), so the
existing Settings code keeps working; only how it is shown changes. It is
a records-register card, not a scroll: it changes the app, not the
cluster.

## 3. Changes

- `web/index.html`: delete `.hud-right-rail`; add the Settings rail
  button at the end of `.hud-left-rail`; `#settings` loses `class="overlay"`
  and becomes `class="hud popover"` placed inside `#hud` next to the left
  rail, with a VIEW row (`data-set="zoom-in" | "home" | "zoom-out"`) above
  the toggles and a rule before the three navigation items.
- `web/src/hud/hud.css`: `#hud .popover` (absolute, `left: 76px`, bottom
  aligned with the rail's last button, 260 px wide, cream card, small
  arrow on its left edge pointing at the gear); the `.view` row's square
  buttons; the sound glyph span. The `.hud-right-rail` rule and its
  comment go; the cluster-panel comment no longer mentions a rail.
- `web/src/hud/hud.ts`: the four rail handlers for zoom, home and sound
  go; `openSettings()` toggles the popover instead of calling
  `openOverlayHere`, wires the VIEW row to `map.zoomBy` and `map.home`,
  closes on outside click (a document `pointerdown` listener added while
  open) and on Escape without touching the modal flag; the sound glyph
  update at the settings-changed hook targets the popover's row.
- `web/src/scenes/MapScene.ts`: `keydown-PLUS`, `keydown-NUMPAD_ADD`,
  `keydown-MINUS`, `keydown-NUMPAD_SUBTRACT` (and `=`) call `zoomBy`,
  guarded by `modal.open` like H.
- `web/src/tour/steps.ts`: the "Around the harbor" step's key list adds
  `+ − zoom`, and its text says Settings holds the view buttons and the
  toggles.
- `web/src/glossary/terms.ts`: the system-fleets entry's "from Fleets or
  Settings" still holds; no change.
- `web/e2e/dock.spec.ts`: the assertion that the bubble stays apart from
  `.hud-right-rail` goes (the element no longer exists); the cluster
  panel assertions stay.
- `web/e2e/tour.spec.ts`: unchanged; the rail step anchors the left rail.
- A new e2e check in `web/e2e/features.spec.ts` (or the glossary spec's
  file, whichever already drives the HUD): open Settings from the rail,
  click VIEW ＋ and assert the camera zoom rose and the popover is still
  open, press Escape and assert it closed, press `-` and assert the zoom
  fell.
- `web/e2e/visual.spec.ts`: the demo-home baseline changes (one more
  rail button, no right rail); `make test-visual-update` refreshes it.
- `PLAN-SWAP.md`: a one-line dated note that the right rail row it
  describes was folded into Settings on the left (this plan).
- README: the sentence that names the right rail, if any, says Settings.

## 4. Size

Half a session: the popover is the only new piece; the rest is moving
buttons and deleting a rail.

## 5. Decisions

Settled with the owner before writing:

1. Placement: bottom of the left rail, an eighth rail button.
2. Zoom and home inside Settings: a popover with a live VIEW row, no
   dimmed modal.
3. Keyboard: `+` / `=` and `-` zoom; H stays home.
