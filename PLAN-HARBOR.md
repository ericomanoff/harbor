# Harbor redesign: a naval scene for Kubernetes and Helm

Status: V0-V3 done, 2026-10-08; V4 in progress. Supersedes `PLAN-VILLAGE.md` (removed)
and the Tiberian Dawn art direction in `PLAN.md` section 3. Everything else
in `PLAN.md` (architecture, backend, phases 0-6, testing layers) stands.

Decisions taken: free assets only (no art generation), the Command & Conquer
flavour is retired, laptop only (no touch), the HUD moves to HTML/CSS over
the canvas.

---

## 1. Why naval

Kubernetes is Greek for helmsman and its logo is a ship's wheel. Helm is the
wheel, Helm charts are nautical charts, pods carry containers, and this
project is called harbor. The scene uses the ecosystem's own vocabulary,
so the map explains itself to anyone who knows Kubernetes:

| Kubernetes | Harbor | How it reads |
|---|---|---|
| Cluster (context) | The harbor | Name and "berths" (node count) in the top-left badge; switching context is "sail to another harbor" |
| Node | Dock (an island with a quay) | Size from allocatable CPU; NotReady = dock dark with a red beacon |
| Namespace | Ensign colour | Hull and flag colour of a namespace's ships; filter = "show fleets" |
| Deployment | Shipyard on a dock | Launches ships; health bar is available/desired; scaffolding while nothing is available |
| Pod | Ship carrying its containers | Launches from its shipyard and sails to its node's quay; crash = on fire; pending = hull in dry dock beside the shipyard; terminating = sinks; old rollout = weathered sails |
| Container | Cargo crate on deck | Count shown as crates (and in the ship's log) |
| ReplicaSet | Launch queue | Dry-dock hulls beside the shipyard during a rollout |
| Node capacity vs requests | Harbor capacity bars | CPU = berths, memory = cargo, pods = crew; top-right bars |
| Service | Lighthouse | Beam lines to the ships it routes to when either is selected |
| Ingress (Phase 6) | Harbor mouth | A breakwater gate on the map edge linked to lighthouses |
| Helm release | Anchorage | A mooring boom (rope and buoys) around the release's shipyards, nameplate buoy; status colours the boom |
| Helm chart | Nautical chart | The shop's CHARTS tab; chart repositories are the chart library |
| Warning events | Signal flags | Toasts near the top, full history under the Log button |
| Logs | Ship's log | The logs overlay, renamed |
| DaemonSet pod (later) | Tugboat | One per dock, never launched by a shipyard |
| StatefulSet pod (later) | Numbered tanker | Hull number painted on |
| Job pod (later) | Fishing boat | Returns and is scrapped |

## 2. Art: Kenney Pirate Pack (CC0)

`web/public/assets/pirate/` holds Kenney's Pirate Pack spritesheet
(`shipsMiscellaneous_sheet.png` + XML atlas, 102 frames) and its 64x64
tilesheet (`tiles_sheet.png`, 96 tiles: water, sand, grass, stone walls and
towers, wood). Licence: CC0 1.0, copied alongside as `LICENSE-kenney.txt`.
Provenance for every asset lives in `art/SOURCES.md`.

What the pack gives us: 24 ship variants across six colours and two sizes
(hull and sail colours map to namespaces), dinghies, crew, cannons, flags in
six colours, fire and explosion frames, wood debris, water and island tiles,
stone wall and tower tiles. What it lacks: a shipyard, a lighthouse, cranes.
Those are composed from tiles (tower + a procedural beam for the lighthouse,
wall tiles + a dry-dock hull for the shipyard) until a better CC0 source is
found; the manifest makes the swap a data change.

Fonts: Nunito variable (OFL, `web/public/fonts/`) for all UI text.

## 3. Visual target

- Top-down, same tile grid as today; tile size moves from 24 to 32 px to
  suit the 64 px pack art at half scale. The map is open water; each node is
  an island dock with a sand quay; a stone breakwater frames the map edge.
- Water: tiled texture with a slow two-layer scroll; foam ring at quays.
- Ships keep the pack's 24 facings? No: the pack ships are drawn facing up;
  rotation gives any heading. Bob animation (±1 px) while moored.
- Every structure has the pack's soft drop shadow; selection is a white
  rounded outline, not brackets.
- HUD in HTML/CSS: full-bleed map, cream rounded cards (12-16 px radius,
  olive 2 px borders, soft shadow), olive translucent dark panels for
  overlays, Nunito 700 for labels, white with dark outline over the map.
  Buttons are pills: green for primary, gold for secondary, grey disabled.
- Audio: wood knocks, bell chime, foghorn for errors; no voice.

## 4. Architecture changes

Unchanged: Go backend, wire contract, store, layout maths, game modules,
all four test layers, demo mode, `make dist`.

- `web/src/gfx/manifest.ts`: logical names (`ship.hull.0`, `tile.water`,
  `fx.fire.0`) → atlas key + frame. Tested against the XML so a missing frame
  fails CI.
- `web/src/hud/` (DOM) replaces `HudScene`: top bar, left rail (Map, Events,
  Log, Move), right rail (Settings, Zoom), shop drawer (ALL / SHIPYARDS /
  LIGHTHOUSES / CHARTS, drag-to-place), selection card, toasts. One
  `hud.css` with design tokens. Existing overlays restyled with the same
  tokens.
- Entities draw pack sprites; `Plateau` → `Dock`, `Building` → `Shipyard`,
  `Unit` → `Ship`, `Service` → `Lighthouse`, `Release` → `Anchorage`.
- Camera: left-drag pans, wheel and the rail zoom, click selects,
  Shift+drag box-selects.

## 5. Phases

### V0: Design system and asset spike — DONE 2026-10-08
- Pack and font in the repo with provenance; manifest with a test.
- `?style` page: every atlas frame and tile on water, plus a DOM panel of
  tokens, buttons, cards, bars, rail buttons, a toast and a shop card.
- Findings: the pack's six hull colours cannot cover eight namespace colours,
  so V1 tints the white ship (`ship 0.x`, hull `hullSmall 0`) with the
  faction palette instead. Tile roles were named from the page (see
  `TILES` in `web/src/gfx/manifest.ts`). Round towers (tile 12) will stand
  in for lighthouses; a crate (59) on a plank (56) beside a hull reads as a
  shipyard until better art exists.
- Decision point: review http://127.0.0.1:8080/?style and confirm before V1.

### V1: Water world — DONE 2026-10-08
- 32 px tiles (pack art at half scale). Sea: tinted water tile with a
  scrolling foam layer, rock breakwater around the edge, an "open sea" strip.
- Docks: one island per node drawn once into a render texture (sand with
  edge tiles, grass heart, bushes seeded by node name), a wooden quay, and
  shallows below where ships moor. NotReady = dimmed with a blinking beacon.
- Shipyards (Deployments): slipway with a hull, crates per replica, an
  ensign flag, health bar, REFIT badge during rollouts.
- Ships (pods): pack ship tinted with a pastel of the namespace colour
  (plain tint made hulls muddy), bobbing at anchor, hull-only while
  pending, fire while crash-looping, weathered when from an old rollout,
  explosion + debris + sinking on delete; they sail from the slipway to
  their berth.
- Lighthouses (Services): round tower with a sweeping beam; selection draws
  white beam lines to the ships they route to.
- Anchorages (Helm releases): rope-and-buoy boom around the release's
  shipyards with a cream nameplate.
- Selection is a white rounded outline; placement ghost is a rounded green
  or red footprint.
- Lesson: the dock render texture must only redraw when the island's size or
  readiness changes. Redrawing on every store event pinned the browser and
  stretched the e2e round from 10 s to 2 min; it is 17 s now.
- The C&C sidebar is still in place until V2.

### V2: DOM HUD — DONE 2026-10-08
- `HudScene` and the sidebar are gone; the canvas fills the window (RESIZE
  scale mode) and `web/src/hud/` draws everything else in HTML:
  harbor badge (click: change context), status chips, BERTHS / CARGO / CREW
  bars, left rail (Map, Log, Find, Fleets), right rail (settings, zoom,
  home, sound), Shop and Charts pills, a selection card with pill actions
  (dangerous ones confirm on a second click), toasts under the top bar.
- Overlays: chart table (2D-canvas minimap, click to sail), harbor log,
  settings; the shop drawer (All / Shipyards / Lighthouses / Charts) builds
  by click-to-place rather than drag, which proved enough.
- All existing overlays restyled to the cream tokens; EVA lines are reworded
  to harbor speak for toasts (`navalise`), the fixed voice vocabulary is
  unchanged underneath.
- The e2e round now drives DOM buttons (`[data-action]`, `[data-shop-open]`)
  instead of canvas coordinates, which made it sturdier (22 s).
- Sea and camera bounds extend 12 tiles beyond the breakwater so the home
  view sits clear of the HUD.

### V3: Motion and feel — DONE 2026-10-08
- Foam wake particles while a ship sails, a splash ring and a floating
  "launched" pill at the slipway, cargo crates on deck (one per container)
  that turn with the hull, smoke over burning ships, a pulsing lighthouse
  lamp, flag flutter on shipyards.
- Audio cues re-synthesised as harbor sounds: wood knock (click), ship's
  bell (done), bell twice (alert), hammering (build), foghorn (error).
- Islands are narrower (12-24 tiles) so a three-node cluster fills the view.

### V4: Polish (1 session)
- Settings overlay, zoom rail, performance pass, visual snapshot tests of
  `?demo` and `?style`.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Sparse-looking sea on small clusters | Breakwater, buoys, rocks and gulls placed by seeded random per node name; island size has a minimum |
| Missing shipyard/lighthouse art | Compose from tiles now; manifest allows a later swap without code changes |
| DOM HUD and canvas input | HUD elements stop pointer events; the map ignores presses that start over `.hud` |
| Pack style vs Crown & Clan reference | Same spirit (bright, chunky, friendly); the UI chrome carries the reference look |

## 7. Testing

Unchanged layers plus: manifest-vs-atlas test (Vitest), Playwright
`toHaveScreenshot` for `?style` and `?demo` from V4 on.
