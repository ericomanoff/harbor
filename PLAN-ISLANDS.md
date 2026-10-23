# Islands you can hover and click

Status: proposed 2026-10-23. Makes every island (node) a first-class map
object: hover for its glossary tooltip, click to select it and read its
card, Papers for the Node, Locate finds it. No change to how islands are
laid out or drawn, and no new write actions.

## 1. The problem

Islands are the only things on the map that ignore the pointer. Ships,
shipyards, lighthouses, gates and expansion plates all hover and select;
an island shows its name label and a red beacon when NotReady, and that
is all. Yet the node is where the interesting numbers live: Ready or
not, allocatable against requested CPU and memory, which ships are
moored there. The `dock:<node>` key already exists for focusing the
camera (Locate for levels, `focusKey`), so the map knows islands as
objects; only the pointer does not.

## 2. The design

**Hover.** Moving over an island's land, its quay or its name label shows
the glossary tooltip for `dock` (island · node), subtitled with the live
facts: `harbor-worker · Ready · 5 ships moored`. The shallows below the
quay stay plain water: ships moor there and must keep the hover.

**Click.** A click on the same area selects `dock:<node>`. The selection
card reads:

```
Island harbor-worker
Ready · node
CPU 650m requested of 4000m allocatable · 16%
Memory 1.0 GiB requested of 16.0 GiB · 6%
5 ships moored · 2 shipyards standing
role control-plane · kubernetes.io/hostname harbor-worker     (labels worth reading)
[ Papers ]  [ Fit island ]
```

- **Papers** opens the Node's spec, status, metadata and managers in the
  existing papers panel. The Node kind joins the backend's papers switch
  and the OpenAPI `kind` enum; the demo harbor's fake clientset serves it
  the same way.
- **Fit island** zooms the camera to the island, as `focusKey('dock:…')`
  already does for Locate.
- No cordon or drain: the API has no node write for real clusters today
  (the academy's drain is a staged incident). A NotReady island's card
  says so in its first line and the tooltip's subject says `NotReady`.

**Selected look.** A selected island gets the same outline every other
selected object has: a rounded rectangle in the sea-outline colour
around the land and quay rows, drawn by the island view and cleared on
deselect. Nothing changes on hover beyond the tooltip.

**Order of precedence.** Ships, lighthouses, shipyards, plates and gates
all sit on islands, so the island is tested last for both hover and
click: anything on it wins. A box-select drag that starts on an island
still box-selects ships, as today; a plain click on land selects the
island; a click on the shallows or open sea clears the selection, as
today.

**Locate.** The search box lists islands as a kind (`dock:<node>`,
shown as "island"), so typing a node name focuses it and selects it.

**Tab.** Islands stay out of the Tab cycle, which walks shipyards and
ships; the cycle is about workloads. (Decision 1 offers the alternative.)

## 3. Changes

- `web/src/entities/Dock.ts`: `landRect()` (world rectangle of the land
  and quay rows plus the label), `setSelected(on)` with a `sel` graphics
  layer above the render texture.
- `web/src/layout/grid.ts`: a pure `dockLandRect(layout)` helper the view
  and the scene share, with a unit test.
- `web/src/scenes/MapScene.ts`: `keyAt()` tests islands last against
  `landRect()`; pointer-up selects `dock:<node>` before falling through
  to `selection.clear()`; `screenRectOf('dock:')` returns the land rect
  (the whole-plateau rect stays for `focusKey`, which needs the shallows
  too); `refreshSelection()` calls `setSelected` on docks; `fitIsland(node)`
  is `focusKey('dock:' + node)` exposed on the map API.
- `web/src/hud/hud.ts`: `hoverTip()` maps `dock:` to the `dock` entry
  with a subject built from the store (ready, ships moored); a
  `dock:` branch in the selection card with the lines above; `formatPower`
  and the existing byte formatter give the CPU and memory lines.
- `web/src/game/search.ts`: `'island'` kind, `dock:<node>` keys, ranked
  with structures; `searchBox.ts` labels them.
- `web/src/ui/papersPanel.ts`: unchanged (kind and name pass through; ns
  is empty for a Node, which the title already handles).
- `internal/kube/papers.go`: `case "Node"`; `api/openapi.yaml`: `Node`
  in the papers `kind` enum; `make gen` regenerates `schema.ts` and
  `gen.go`; a server test for Node papers beside the existing ones.
- `web/src/glossary/terms.ts`: the `dock` entry's in-harbor line adds
  "hover an island for its state, click it for its card".
- Tests: `grid.test.ts` for `dockLandRect`; a new `web/e2e/islands.spec.ts`
  in the demo harbor: hover land shows the `dock` tooltip with the node
  name in its subject, click selects and the card reads "Island …" with
  the ships-moored count matching the store, Papers opens with
  `kind: Node`, clicking the shallows clears, and a ship on the island
  still wins the click. Added to the Makefile's e2e list. The demo-home
  visual baseline is unchanged (nothing selected at home).

## 4. Size

Half a session for the map and card; a quarter for Node papers across
the backend, schema and server test.

## 5. Decisions

1. Tab cycle: islands stay out (recommended) or join the cycle ahead of
   shipyards.
2. Hover area: land, quay and label only (recommended) or the whole
   plateau including the shallows, with ships still winning.
3. Papers for Node: add it now (recommended) or ship the card without a
   Papers button and add it later.
