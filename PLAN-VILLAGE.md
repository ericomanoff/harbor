# Village redesign: Crown & Clan look for Harbor

Status: plan, 2026-10-08. Supersedes the Tiberian Dawn art direction in
`PLAN.md` section 3; everything else in `PLAN.md` (architecture, backend,
phases 0-6) stands. The reference is the Crown & Clan village builder shown
at https://phaser.io/news/2026/09/crown-clan-phaser-village-builder.

---

## 1. What the reference looks like

From the three published screenshots:

| Aspect | Reference |
|---|---|
| Perspective | Isometric, 2:1 diamond grid (visible as red diamond outlines in the replay view), buildings sit on footprints of 2x2 to 4x4 cells |
| Art | Pre-rendered 3D look: chunky, rounded, hand-painted textures, saturated colour, soft ambient occlusion, a drop shadow under every object, slight toon outlines |
| Palette | Grass greens (#7cc242 to #4f9a2a), warm wood oranges and tans, stone greys, gold and purple as resource accents, deep olive-green translucent panels |
| World | One large grass field with a pine-forest border, scattered rocks and bushes, low stone walls segmenting compounds, roads implied by trampled paths |
| Motion | Troops walk between buildings, campfire flames, flags, builders' hammers; "collected" pills pop over buildings |
| UI chrome | Full-bleed map, no sidebar. Top-left: level badge + village name + trophies. Top-centre: title and status chips. Top-right: three resource bars with "+" buttons. Left rail: four cream square buttons (Map, Quests, Edit, Log). Right rail: settings gear, zoom +/−. Bottom: a cream shop drawer with tabs and horizontally scrolling cards. Toasts and a tutorial card float near the top |
| Type | Rounded, heavy sans-serif (Nunito/Fredoka class), white with dark outline over the map, dark olive on cream |
| Buttons | Pill-shaped, gradient green for affordable actions, grey "At limit" when not, gold for secondary |

The look is friendly and toy-like rather than military. The C&C sidebar,
green radar, bevelled grey chrome and monospace EVA log all go.

## 2. Licensing: we must make or buy our own art

The reference repository states its artwork is Supercell's and that nothing
in it is licensed for reuse. None of it can be copied. Three ways to get the
look legally, in increasing effort and fidelity:

1. **CC0 packs as the base** (days). Kenney's isometric packs (CC0, e.g. the
   Isometric Buildings and Isometric Miniature series) and similar CC0 or
   commercially licensed packs on itch.io / OpenGameArt give chunky
   low-poly-render buildings, trees, rocks, fences and simple characters.
   They look toy-like and bright, which matches the reference's spirit if
   not its exact style. Fastest route to "looks like a village".
2. **Generated images, cleaned up** (days to weeks). An image model can
   produce building sprites in a consistent "isometric, soft 3D, white
   background" prompt family; backgrounds removed, scaled to the grid,
   shadows added in the pipeline. Consistent lighting needs care. Check
   your organisation's policy on generated art.
3. **Own 3D render pipeline** (weeks, most faithful). Model buildings in
   Blender (or MagicaVoxel for a chunkier look), one fixed isometric camera
   and light rig, render to sprite sheets with a script. This is how the
   reference look is actually produced. Every Kubernetes concept gets a
   bespoke building.

Recommendation: start on 1 so the world, HUD and interactions can be built
and judged on real screens, and run 3 (or 2) as a parallel art track that
swaps sprites in through the asset manifest. The code never depends on which
track supplies the pixels.

## 3. Visual target

- Isometric grid, 2:1, base tile 64x32 px at zoom 1. World is one grass
  field; node "districts" are clearings separated by hedges or low walls,
  each with a Town Hall-style node marker. The map edge is a pine-forest
  border with the camera clamped inside it.
- Every object has a soft elliptical shadow. Depth sorting by cell (x+y),
  taller objects anchored at their footprint's bottom corner.
- Namespaces: colour the flag or banner on a building, not the whole sprite.
  Eight banner colours remain.
- HUD is HTML/CSS over the canvas (the game only draws the world):
  rounded cream cards, 12-16 px radius, 2 px olive borders, drop shadows;
  Nunito (OFL, bundled) for all text; map labels white with a dark outline.
- Light, cheerful audio: wood knocks for placement, a soft chime for
  completion, a crackle for fires, a short horn for errors. The EVA voice is
  replaced by a "town crier" text toast; speech synthesis becomes optional.

## 4. Theme remap: Kubernetes as a village

| Kubernetes | Village | Notes |
|---|---|---|
| Cluster (context) | Your village | Name and "level" (node count) in the top-left badge; switching context is "Visit another village" |
| Node | District | A clearing with a Town Hall marker showing capacity; NotReady = district on fire / darkened |
| Namespace | Clan banner colour | Flags on buildings; filter = "show clans" |
| Deployment | Barracks (workshop) | Produces troops; health bar is available/desired |
| Pod | Troop (villager) | Walks out of its barracks to its district; crash = on fire, pending = sitting at the barracks door, terminating = walks off and fades, old rollout = older uniform (desaturated) |
| ReplicaSet | Training queue | Dots above the barracks during a rollout |
| Node capacity vs requests | Gold / Elixir / Gems bars | CPU = gold, memory = elixir, pod count = gems; "+" opens the node details |
| Service | Watchtower | Paths (trampled grass) drawn to the troops it routes to when selected |
| Ingress | Village gate | Phase 6 item; a gate on the border road linking to watchtowers |
| Helm release | Walled compound | Stone wall segments around the release's buildings, a nameplate flag; status colours the wall glow |
| Helm chart | Shop card | The shop drawer's "Expansions" tab lists charts; dragging a card places the compound |
| Events (Warning) | Toasts + Log | Town-crier toast near the top, full history behind the Log rail button |
| Create / scale / delete | Shop, tap-to-select, action card | Select a building to get a card with Train (+1), Dismiss (−1), Upgrade (Helm), Move, Sell |
| Build placement | Drag from shop | Drag a card onto clear ground, green/red footprint, drop to open the details form |

## 5. Architecture changes

What does not change: the Go backend, the wire contract, the store, the
layout module's tile maths, the game logic modules, and all of the test
layers. The redesign replaces rendering and HUD only. That is the payoff of
keeping scenes thin.

### Rendering
- `web/src/iso/projection.ts`: tile ↔ screen conversion for a 2:1 grid,
  footprint anchoring, depth key. Pure, unit-tested. The current layout
  (plateaus, cells, placements) is reinterpreted on the isometric grid
  unchanged; "plateau" becomes "district".
- `web/src/iso/terrain.ts`: grass tile layer (tiled texture), district
  hedges/walls, pine border, decorative rocks and bushes placed by a seeded
  random from the node name so they never move.
- Asset manifest `web/public/assets/manifest.json` + `web/src/gfx/assets.ts`:
  every sprite is referenced by a logical name (`barracks.idle`,
  `troop.walk.se`), so an art track can swap files without code changes.
  Atlases built by a script (`scripts/pack-atlases.mjs`, free-tex-packer) from
  `art/` sources; provenance per asset in `art/SOURCES.md`.
- Entities become sprite-sheet animations: barracks idle, build-up
  (scaffold → bounce in), fire overlay, troop walk cycles in 8 directions,
  campfire, flags. Phaser animation keys live in one `anims.ts`.
- Camera: left-drag pans, wheel and the +/− rail zoom, tap selects. Box
  select moves to Shift+drag. Pinch zoom for touch.

### HUD (DOM)
- `web/src/hud/` replaces `HudScene`: `topBar.ts` (badge, title, status
  chips, resource bars), `leftRail.ts` (Map/Quests→Events, Log, Edit→Move
  mode), `rightRail.ts` (settings, zoom), `shop.ts` (drawer with tabs All /
  Workloads / Network / Expansions, cards from the structure catalogue and
  the Helm chart search, drag-to-place), `selectionCard.ts` (replaces the
  sidebar readout and command buttons), `toasts.ts` (events, EVA lines),
  plus the existing overlays restyled (build form, locate, filter, tech
  tree, logs, theater).
- One stylesheet `hud.css` with design tokens (colours, radii, shadows,
  type scale). The existing modal flag and Escape handling stay.
- The radar minimap becomes a "Map" overlay opened from the rail rather than
  an always-on panel.

### Audio
- `game/audio.ts` keeps the synthesised fallback but loads short OGG/MP3
  cues from the manifest when present. Voice lines become toast text.

## 6. Phases

Each phase ships behind the same `?demo` mode and the same tests.

### V0: Design system and asset spike (1 session)
- Choose the base asset pack(s); write `art/SOURCES.md`; build the atlas
  script and manifest; add Nunito.
- A `?style` demo page renders every sprite, button, card and colour token on
  one screen for review. Decision point: confirm the pack before V1.

### V1: Isometric world (2 sessions)
- Projection module with tests; terrain layer with pine border; districts;
  depth sorting; camera clamp.
- Existing entities re-rendered as sprites from the manifest (static first).
- Done when the kind cluster shows as a village with three districts and
  the current interactions still work (select, drag-move, placement ghost).

### V2: DOM HUD (2 sessions)
- Top bar with resource bars, left and right rails, selection card, toasts,
  shop drawer with drag-to-place for War Factory → Barracks and Helm charts.
- Remove `HudScene` and the C&C chrome; restyle overlays.
- Done when the e2e round passes against the new HUD (its selectors change
  from canvas coordinates to DOM buttons, which also makes it more robust).

### V3: Motion (1-2 sessions)
- Troop walk cycles and facings, barracks build-up and bounce, fire and
  smoke, flags, campfire; walls for releases; paths for services.
- Collected-style pills for "unit ready" and "construction complete".

### V4: Interaction and polish (1 session)
- Touch and pinch, keyboard parity, zoom rail, settings overlay (sound,
  clans filter, theater), cheerful audio cues, performance pass (object
  pooling for troops, texture atlas budget).

### V5: Bespoke art track (parallel, open-ended)
- Blender render rig and sprite export script; replace pack sprites per
  building type through the manifest; one Kubernetes-specific building per
  concept (barracks, watchtower, gate, walls, town hall, shrine for Helm).

## 7. What stays and what goes

Stays: single-binary backend, stream, store, layout, game modules, overlays'
behaviour, all tests, demo mode, `make dist`.

Goes: the 200 px sidebar, radar panel, bevels and black/green palette,
monospace everywhere, generated pixel tank and factory textures, EVA voice
by default. The RTS vocabulary (War Factory, EVA) is retired in favour of
village terms; the C&C plan sections are kept in git history.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Art style drift between packs | One pack family per class of object; a style page in V0 to judge together; tint and shadow applied uniformly in the pipeline |
| Isometric hit-testing and placement feel | Footprint maths in a pure, tested module; placement ghost on the diamond grid; buildings anchored at the bottom corner |
| DOM HUD over canvas input conflicts | Pointer events on HUD elements never reach Phaser; the map ignores pointer-down while the pointer is over `.hud` |
| Many sprites on large clusters | Atlases, object pooling, animation sharing; cap decorative density by zoom |
| Phaser 3 vs 4 | Stay on 3.90; the renderer is isolated behind entities so a later move is contained |
| Generated-art policy | Decide in V0; track 1 and 3 need no generated images |

## 9. Testing

Existing layers continue unchanged. Add Playwright visual snapshots of the
`?demo` and `?style` pages (`toHaveScreenshot`) so unintended rendering
changes fail CI. The e2e round moves to DOM-based selectors once V2 lands.

## 10. Open questions

1. Art route: start with CC0 packs (recommended) or go straight to a Blender
   pipeline? Is generated art acceptable for your use?
2. Keep any C&C flavour (EVA voice as an easter egg) or retire it fully?
3. Is touch/mobile a priority for V4, or desktop only?
4. HUD in DOM is my recommendation; any objection to mixing DOM and canvas?
