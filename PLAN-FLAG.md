# A proper namespace flag on every shipyard

Status: done 2026-10-23 (both decisions as recommended). One visual change to the map plus its hover.

## 1. The problem

The shipyard on the map carries a namespace flag already, but it is a
Kenney pennant sprite that is 6 by 22 px at source and drawn at half
scale: a 3 px sliver at the top-left corner, tinted with the namespace
colour. At home zoom it is a dot; nobody reads it as a flag, and the
hover rectangle for it (the one that shows the namespace tooltip) is
larger than the flag itself. The structure label under the shipyard is
tinted the same colour, which is the only place the fleet is really
visible.

## 2. The design

Replace the pennant with a **drawn flag on a pole**, big enough to read:

- A pole at the shipyard's top-left corner, 2 px wide and 26 px tall,
  with a flag 20 by 13 px flying to the right, filled with the namespace
  colour and edged in white, drawn with Phaser graphics (no new art,
  consistent with the rest of the structure drawing). It waves: the free
  edge moves with the same sine the pennant used.
- **An initial on the flag**: the namespace's first letter in white, bold,
  9 px, so two fleets with similar colours can be told apart at a glance
  (`s` for sandbox, `h` for harbor, `k` for kube-system).
- Same flag on **tanker terminals** (StatefulSets share the structure
  class) and on **tug companies** and **fishing fleets** if they ever gain
  a structure; today they are drawn as ships, which already carry an
  ensign on the card.
- **Hover**: the existing `flag:<ns/name>` hit-test grows to the new
  flag's rectangle, and the tooltip shows the namespace entry titled with
  the actual fleet name (`namespace · fleet sandbox`) rather than the
  generic entry, by passing the name through to the tooltip as a subtitle
  line.
- **Click** on the flag opens the Fleets filter with that namespace
  highlighted, so the flag is also the fastest way to isolate a fleet.
- The namespace colour palette stays (hash of the name); the structure
  label keeps its tint so nothing else moves.

## 3. Changes

- `web/src/entities/Shipyard.ts`: `flag` becomes a `Phaser.GameObjects.Graphics`
  pole and flag plus a `Text` initial; `redraw()` fills it with the
  namespace colour; `tick()` waves the free edge; `flagRect()` returns the
  pole-plus-flag rectangle.
- `web/src/hud/hud.ts`: `hoverTip()` passes the namespace name for
  `flag:` keys; `Tooltip.showFor()` accepts an optional subtitle.
- `web/src/scenes/MapScene.ts`: pointer-up on a flag opens the Fleets
  filter (`openFilter({ highlight: ns })`); `filterPanel.ts` scrolls to and
  outlines that row.
- Glossary `namespace` entry's harbor line mentions the initial.
- Visual baseline of the demo harbor refreshed; a unit test for the flag
  rectangle arithmetic is not worth it (pure drawing); the glossary spec
  hovers a flag and asserts the subtitle names the fleet.

## 4. Size

Half a session.

## 5. Decisions

1. Initial on the flag: yes (recommended) or plain colour.
2. Click opens the Fleets filter (recommended) or does nothing.
