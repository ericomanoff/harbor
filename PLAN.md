# Harbor: a Command & Conquer style GUI for Kubernetes and Helm

Status: Phases 0-5 complete; Phase 6 in progress (updated 2026-10-08).

## Progress

| Phase | Status      | Notes                                                                 |
|-------|-------------|-----------------------------------------------------------------------|
| 0     | Done        | 2026-10-07. Go server + embedded Vite/Phaser app, OpenAPI codegen both sides, Makefile, kind config, tests. |
| 1     | Done        | 2026-10-07. Contexts, informers for 6 kinds, wire conversion, hub, /ws, /api/snapshot, startup auto-connect. `make test-kind` passes against kind-harbor. |
| 2     | Done        | 2026-10-07. Store + WebSocket reconnect, deterministic layout, plateaus/buildings/units, camera, selection, radar, EVA log. Live: `kubectl scale` 3→5→3 showed units deploy and die within ~2 s. |
| 3     | Done        | 2026-10-07. War Factory cameo + placement ghost, HTML build form, create/scale/mappos endpoints, build/retire/sell commands (sell retires the exact pods via pod-deletion-cost), power bar, building drag-move. Live: built, spawned 5, sold 2, restarted, site persisted. |
| 4     | Done        | 2026-10-07. Generated pixel-art sprites (8-facing tank, factory, scaffold, fire, explosion), rollout hatching + badge, warning flashes, sell structure (confirm) and repair unit, Tab cycling, "/" locate overlay, F namespace filter, M synthesised sfx + EVA voice (speechSynthesis, fixed vocabulary). Regression suite: pure game modules, kind round trip, Playwright e2e round incl. search and filter. |
| 5     | Done        | 2026-10-07. Helm v3.22 SDK in-process: repos, chart search, default values, install/upgrade/rollback/uninstall/history; releases tracked live from Helm storage secrets; release-owned Deployments placed as a block inside a dashed base perimeter; T opens the tech tree overlay (charts/repos/expansions, install and upgrade forms with a values editor); release selection on the map with UPGRADE/ROLLBACK/SELL. Tests: in-memory Helm store, API round trip, kind integration with the real secrets driver. |
| 6     | In progress | 2026-10-08: Services (lighthouses) with beam links; logs panel; context picker; `make dist`. Later the same day: StatefulSets as tanker terminals launching numbered tankers, DaemonSets as tug companies (one tug per dock), Jobs as fishing fleets that come home; scale/delete/mappos endpoints for them; a welcome tour (see PLAN-HARBOR.md); Ingresses as gates in the breakwater at the harbor mouth with channels to their lighthouses and a delete endpoint. The shop now builds tanker terminals (StatefulSet + headless Service, optional volume) and opens gates (Ingress with one host/path rule, TLS). Left: exec, fog of war, Job create form, Tauri. |                                                                       |

Deviations from the original plan so far:

- TypeScript is pinned to 5.x. TypeScript 7 (the Go-based compiler) dropped the
  compiler API that openapi-typescript depends on.
- OpenAPI parameter components are suffixed `Param` (`NamespaceParam`) because
  oapi-codegen cannot have a parameter and a schema both named `Namespace`.
- A pre-existing 3-node kind cluster named `harbor` (OrbStack Docker) is
  reused rather than recreated; `make kind-up` fails if it already exists, so
  apply `deploy/kind/sample-workloads.yaml` by hand in that case.
- client-go v0.37 requires Go 1.26, so go.mod says 1.26 and the Go toolchain
  auto-downloads it (GOTOOLCHAIN=auto). The locally installed go is 1.25.
- The backend auto-connects to the kubeconfig current-context at startup
  (`-context` overrides, `-no-connect` disables) so the map is live without a
  click. Failure to connect is logged, not fatal.
- Events older than two minutes when first seen are not broadcast, so a fresh
  client is not flooded with history; a dropped-message counter on the hub
  covers slow WebSocket clients.
- `?demo` in the URL runs the map against a built-in fake cluster that
  mutates itself, so map and art work never needs a backend.
- `window.harbor` exposes the game, store, selection and settings for
  devtools, and lets a hidden tab's game loop be stepped by hand (Chrome
  stops animation frames in hidden tabs, which stalls Phaser).
- Phaser containers reserve `body` and `state`; entity fields use `shape`
  and `status` instead.
- "Sell unit" scales the Deployment down by the number of selected pods and
  annotates exactly those pods with `controller.kubernetes.io/pod-deletion-cost`
  so the ReplicaSet retires them first. Scale and map-position writes are
  merge patches (the fake clientset cannot do the scale subresource).
- Deployments created from the game get `app.kubernetes.io/managed-by: harbor`
  and default requests of 50m CPU / 64Mi (editable in the form) so new units
  register on the power bar.
- Map positions snap to 3x3 building cells; a `harbor.dev/map-pos` that is
  not a cell origin, or is occupied, falls back to auto-placement.
- Hidden Chrome tabs do not deliver keyboard events to Phaser and synthesized
  hovers do not move its pointer, so pointer handlers use the event's pointer
  (not `input.activePointer`); that also fixes touch input. Visual checks
  now go through headless Chromium (Playwright), which runs the game loop.
- Audio is fully synthesised (WebAudio beeps, browser speechSynthesis for a
  fixed EVA vocabulary that never reads names). Off by default; the M toggle
  doubles as the user gesture browsers need before playing sound.
- Overlays (build form, locate, filter, tech tree) are plain HTML over the
  canvas and set a modal flag the scenes check before handling keys; hotkeys
  that open an overlay call preventDefault so the key does not type itself
  into the overlay's input.
- Helm: releases reach the frontend live by watching Helm's storage secrets
  (`owner=helm` label) and reading name/version/status from their labels;
  chart details come from the SDK on demand. Repository config follows
  Helm's own paths, so repos added with the helm CLI appear in the tech
  tree. Upgrade without a chart reuses the chart stored in the release.
  Helm's map-position is stored as a release label (`x_y`, since labels
  cannot hold commas) but the perimeter is derived from member Deployments.
- Helm v3.22 pins k8s.io/* at the versions client-go already used, so no
  module conflicts; Helm 4's SDK was not adopted yet.
- Fog of war as planned (per-namespace RBAC) does not fit cluster-wide
  informers: a denied cluster-wide list fails the whole sync rather than one
  namespace. Doing it properly means per-namespace informers for users
  without cluster-scope list rights; deferred.
- Services sit in the unit zone of the plateau hosting most of their pods
  and claim their tile before units do, so they stay put as units churn.
  Links are drawn only for the selected service or unit to avoid clutter.
- Overlays close on Escape through a window-level capture listener (an
  overlay like logs holds no focus); keys typed inside an overlay stop at
  its root so Phaser never sees them.

Decisions already made:

| Decision        | Choice                                                     |
|-----------------|------------------------------------------------------------|
| Frontend        | Phaser 3 + TypeScript + Vite                               |
| Backend         | Go (client-go informers, Helm Go SDK in-process)           |
| Art direction   | Tiberian Dawn / Red Alert 1: top-down 2D pixel art         |
| Clusters        | Any kubeconfig context, picker on the start screen         |
| First playable  | Create and scale Deployments; pods appear as units         |
| Later           | Helm tech tree, Services/Ingress, logs/events, delete      |

Environment today: Go 1.25, Node 26, kubectl, kind. Helm binary is not needed
because the Go SDK runs in-process. The `kind-harbor` context exists but no kind
cluster is currently running; recreate it before Phase 1.

---

## 1. The metaphor: Kubernetes as an RTS base

Every Kubernetes object maps to one RTS concept. The mapping is the product; the
code follows from it.

| Kubernetes               | RTS concept                | How it shows on the map                                                     |
|--------------------------|----------------------------|-----------------------------------------------------------------------------|
| Cluster (context)        | The theater / map          | One map per context. Start screen = mission select.                         |
| Node                     | Plateau of buildable land  | Each node is a landmass. Node allocatable CPU/mem = its size. NotReady = cratered, dark. |
| Namespace                | Faction / sector colour    | Every structure and unit carries its namespace colour. Namespace filter = "radar colour" toggle. |
| Deployment               | Production structure (War Factory) | A building. Placed by the player, persists where placed. Under construction until available replicas > 0. |
| ReplicaSet (current)     | Production queue           | Queue dots on the building; rollout = new RS draining the old.              |
| Pod                      | Unit                       | Rolls out of its Deployment's door, drives to the plateau of the node it was scheduled on, idles there. |
| Pod phase / health       | Unit health and state      | Pending = being built; Running+Ready = idle; NotReady = yellow health; CrashLoopBackOff = on fire, flashing red; Terminating = death animation; Failed/Evicted = wreck. |
| Container restarts       | Health bar                 | Health drops with restarts, recovers while stable.                          |
| Node allocatable vs requests | Power                  | The C&C power bar on the sidebar. Overcommit = low power, sidebar flickers. |
| Events (Warning)         | EVA announcements          | Text log at bottom-left and a one-line "EVA" toast: "Unit lost", "Construction complete", "Insufficient power". |
| Service                  | Radar / comms structure    | Phase 6. Draws links (power lines) to the units it selects.                 |
| Ingress                  | Gate / outer wall          | Phase 6.                                                                    |
| Helm repository          | Tech tree                  | Phase 5. Charts are unlockable build options on the sidebar.                |
| Helm release             | Base expansion             | Phase 5. Installing places every workload the chart creates, grouped.       |
| RBAC-denied namespaces   | Fog of war                 | Phase 6. Shroud over territory you cannot list.                             |

Player actions map to kubectl verbs:

| Player action                              | API call                               |
|--------------------------------------------|----------------------------------------|
| Click War Factory icon, place footprint, fill form | create Deployment                |
| Select building, click "Build unit"        | scale replicas +1                      |
| Select unit, click "Sell"                  | scale replicas -1 (and delete that pod)|
| Select building, click "Sell structure"    | delete Deployment (Phase 4)            |
| Select unit, click "Repair"                | delete pod so it is recreated (Phase 4)|

Map positions must be stable across restarts. Store each Deployment's placed tile
in an annotation on the Deployment itself (`harbor.dev/map-pos: "x,y"`). Objects
with no annotation (pre-existing or Helm-created) are auto-placed with a
deterministic layout seeded by namespace and name, so the map looks the same
every time you open it.

---

## 2. Architecture

```
+-----------------------------+          +------------------------------------+
|  Browser                    |          |  harbor (single Go binary)         |
|  Phaser 3 game (TS, Vite)   |  WS      |  internal/api   REST + WebSocket   |
|   MapScene   HUDScene       |<-------->|  internal/kube  contexts, informers|
|   DOM overlay for forms     |  REST    |  internal/helm  Helm SDK actions   |
|   store/  (cluster state)   |          |  internal/model wire types         |
+-----------------------------+          |  web/dist embedded via embed.FS    |
                                         +------------------+-----------------+
                                                            | client-go
                                                            v
                                                   Kubernetes API server
```

### Backend (Go)

- Stdlib `net/http` with Go 1.22+ method routing. No framework.
- `internal/kube`: loads kubeconfig with standard loading rules, lists contexts,
  builds a clientset + dynamic client per selected context. Runs shared
  informers for Nodes, Namespaces, Deployments, ReplicaSets, Pods, Events.
  Informer handlers convert objects into lean wire models and push them to a
  broadcast hub.
- `internal/api`: REST for commands and snapshots, one WebSocket for the event
  stream. Binds `127.0.0.1` only. Origin check on the WebSocket upgrade. No auth
  in v1 because the binary runs as the user with their own kubeconfig.
- `internal/helm`: wraps `helm.sh/helm/v3/pkg/action` (repo add/update, search,
  install, upgrade, uninstall, list, history, rollback). Pin the Helm module
  version; the SDK is not promised stable across minors.
- `web/dist` embedded with `embed.FS`; `go run ./cmd/harbor` serves the whole app
  on `http://127.0.0.1:8080`.

### API contract

One `api/openapi.yaml` is the source of truth. Wire models are deliberately
small summaries, not raw Kubernetes JSON, so the frontend never parses a full
Pod spec.

- Go: `oapi-codegen` generates server interfaces and model structs.
- TS: `openapi-typescript` generates types for the client.

WebSocket message:

```json
{ "type": "added|modified|deleted|snapshot", "kind": "Pod", "obj": { ...wire model... } }
```

Core wire models (v1):

```
Node       { name, ready, cpuAlloc, memAlloc, cpuReq, memReq, labels }
Namespace  { name, phase }
Deployment { ns, name, replicas, available, updated, image, mapPos?, conditions[] }
Pod        { ns, name, node, phase, ready, restarts, reason, ownerRS, deployment?, created }
Event      { ns, kind, name, type, reason, message, ts }
```

REST (v1):

```
GET  /api/contexts                  list kubeconfig contexts, current
POST /api/contexts/{name}/select    start informers for that context
GET  /api/snapshot                  full state for a fresh client
POST /api/deployments               create (ns, name, image, replicas, port, mapPos)
PATCH /api/deployments/{ns}/{name}/scale   { replicas }
PATCH /api/deployments/{ns}/{name}/mappos  { x, y }
GET  /ws                            event stream
```

### Frontend (Phaser 3 + TypeScript)

- Vite dev server proxies `/api` and `/ws` to the Go binary for hot reload.
- `src/store/`: a plain typed event-emitter store holding the cluster snapshot.
  Informer diffs mutate the store; the map subscribes. No Phaser code in the store,
  so it is unit-testable with Vitest.
- Scenes:
  - `BootScene`: loads atlases, bitmap font, audio.
  - `MissionSelectScene`: context picker styled as the C&C mission map.
  - `MapScene`: tilemap, camera (edge-scroll, drag, zoom), node plateaus,
    buildings, units, selection box, placement cursor.
  - `HUDScene`: runs in parallel. Black sidebar: radar minimap top, build strip
    (structures column | units column), power bar, credits-style resource line.
    Bottom-left EVA log.
- Forms (create deployment, Helm values) are an HTML overlay styled to match
  the sidebar, because text input in canvas is painful. Everything else is
  canvas.
- Rendering: `pixelArt: true`, nearest-neighbour scaling, logical resolution
  960x600 scaled to the window.

---

## 3. Art direction

> Superseded on 2026-10-08 by `PLAN-HARBOR.md`: the look moves from Tiberian
> Dawn to a bright top-down naval scene (Kenney CC0 art, DOM HUD). The
> section below is kept for history; the architecture sections still apply.

Match the 1995-96 look without using EA assets. The Tiberian Dawn source is GPL
but the art, sounds and voices are not, so every sprite, icon and sound is
original and made in the style.

- Palette: near-black sidebar (#0a0a0a) with grey bevelled frames (#5a5a5a /
  #2c2c2c highlights), radar green (#39ff14 on #001a00), amber warning text
  (#ffb000), red alert (#ff2a2a). Namespace colours come from a fixed 8-colour
  faction palette (gold, red, blue, teal, orange, purple, green, grey).
- Terrain: 24x24 tiles, dirt/sand with cliffs delimiting node plateaus, dark
  shroud for off-map.
- Buildings: 48x48 to 72x72, two-frame idle animation, build-up animation of
  6 frames, sell/destroy animation.
- Units: 24x24, 8-facing rotation, 3-frame drive cycle, burning overlay,
  explosion death.
- Sidebar icons: 60x48 cameo-style portraits with a grey bevel; greyed and
  "hatched" when unavailable.
- Font: a condensed pixel bitmap font rendered through Phaser BitmapText.
- Audio: short synthesized clicks, a build hum, an EVA-like voice generated
  with TTS for a dozen fixed lines. Off by default until Phase 4.
- Phase 1-3 ship with procedural placeholder graphics (coloured rectangles and
  simple shapes drawn with Phaser Graphics). Real pixel art lands in Phase 4 so
  gameplay is never blocked on art.

---

## 4. Phases

Each phase ends with something you can run against the kind cluster.

### Phase 0: Scaffold (1 session) — DONE 2026-10-07

- `go mod init`, `cmd/harbor/main.go` serving a hello page on 127.0.0.1:8080.
- `web/` Vite + Phaser + TS app with one empty scene; `npm run build` output
  embedded into the binary.
- `api/openapi.yaml` with the v1 models above; codegen wired into `make gen`.
- `Makefile`: `make dev` (Go with air + Vite), `make build`, `make test`,
  `make kind-up` (creates the harbor kind cluster with a sample nginx deployment).
- Done when: one command starts both servers and the browser shows a black
  Phaser canvas served by Go.

### Phase 1: Backend read path (1-2 sessions) — DONE 2026-10-07

- Context listing and selection.
- Informers for Node, Namespace, Deployment, ReplicaSet, Pod, Event. Wire-model
  conversion with the Pod to Deployment owner resolution via ReplicaSet.
- Broadcast hub and `/ws`; `/api/snapshot`.
- Tests: conversion unit tests with `fake.NewSimpleClientset`; one integration
  test that runs against kind if `HARBOR_KIND_TEST=1`.
- Done when: `websocat ws://127.0.0.1:8080/ws` prints a snapshot and then live
  diffs while you `kubectl scale` something.

### Phase 2: The map (2 sessions) — DONE 2026-10-07

- Store wired to the WebSocket with reconnect and resnapshot.
- MapScene: node plateaus laid out on a tile grid sized by allocatable CPU;
  namespace-coloured buildings for Deployments; units for Pods that drive from
  their building to their node.
- Deterministic auto-placement for objects without `harbor.dev/map-pos`.
- Camera: edge scroll, drag, zoom, minimap click-to-jump.
- Selection: click and drag-box; info panel in the sidebar shows the wire model.
- Pod state visuals with placeholder graphics (colour and blink only).
- Done when: opening the app shows the kind cluster live and a `kubectl scale`
  makes units roll out or die within a second.

### Phase 3: Build and scale (1-2 sessions) — first playable — DONE 2026-10-07

- Sidebar structure icon "War Factory" = Deployment. Click, place footprint
  (green valid / red invalid, must be on a plateau), form opens (namespace,
  name, image, replicas, container port), submit.
- Building shows under-construction until `available > 0`; EVA says
  "Construction complete".
- Select a building: units column shows "Build unit" (scale +1). Select a unit:
  "Sell" (scale -1, deleting that pod). Power bar reflects requests vs
  allocatable.
- Map position written to the annotation on create and on drag-move.
- Done when: you can build a deployment, spawn five pods, sell two, all from
  the game, and the state survives a restart of the binary.

### Phase 4: Polish and feel (2-3 sessions) — DONE 2026-10-07

- Replace placeholders with original pixel-art sprites, build/sell/death
  animations, burning and crashloop effects, 8-facing unit movement.
- Events feed as EVA log plus voice lines; warning events flash the building.
- Sell structure (delete Deployment) with confirm; Repair unit (delete Pod).
- Rollout visualisation: new ReplicaSet units replace old ones one by one.
- Namespace filter toggles, search box, keyboard shortcuts (H to home camera,
  Tab to cycle selection).

### Phase 5: Helm tech tree (2-3 sessions) — DONE 2026-10-07

- `internal/helm` with repo add/update, search, show values, install, upgrade,
  uninstall, list, history, rollback. Pinned Helm module.
- Sidebar gains a "Tech" tab: repositories are tech buildings, charts are
  unlockable cameos. Installing a chart places a release footprint; the
  workloads it creates are grouped inside a dashed base perimeter labelled by
  release.
- Values editor as a DOM overlay with a YAML text area and the chart defaults.
- Release status (deployed, failed, pending) on the perimeter; upgrade and
  rollback from the selection panel.

### Phase 6: Extended world (ongoing) — IN PROGRESS

- Services as radar structures with power-line links to selected pods;
  Ingress as gates.
- Logs and exec panels (streaming over the WebSocket).
- Fog of war for namespaces where `SelfSubjectAccessReview` denies list.
- StatefulSets and DaemonSets as distinct structure types; Jobs as one-shot
  units.
- Packaging: goreleaser for darwin/linux/windows binaries; optional Tauri shell.

---

## 5. Repository layout

```
harborV2/
  cmd/harbor/main.go
  internal/
    api/        handlers, websocket hub, generated server code
    kube/       context loading, informers, wire conversion
    helm/       Helm SDK wrapper (Phase 5)
    model/      generated wire models
  api/openapi.yaml
  web/
    index.html, vite.config.ts, package.json
    src/
      main.ts
      scenes/   Boot, MissionSelect, Map, Hud
      entities/ Building, Unit, Plateau
      store/    cluster store, ws client, generated types
      ui/       sidebar widgets, DOM overlays
      layout/   deterministic placement
    public/assets/   atlases, font, audio
  deploy/kind/      kind config and sample workloads
  Makefile, go.mod, README.md
```

---

## 6. Testing

Four layers, fastest first. Run `make test` before every commit; the other
two need the kind cluster.

| Layer | Command | What it covers | Time |
|-------|---------|----------------|------|
| Go unit | `make test-go` | wire conversion, current-RS resolution, hub, watcher against a fake clientset, kube actions (create/scale/sell/mappos/delete), HTTP handlers incl. WebSocket and error mapping | ~2 s |
| Frontend unit | `make test-web` | typecheck (app + e2e), store, layout/placement, colours, API client, and the pure game modules: unitState/isObsolete, power, sellPlan, EvaFeed | ~1 s |
| Kind integration | `make test-kind` | real informers: snapshot shape, then create → ready → scale → sell a named pod → move → delete, each confirmed on the stream | ~5 s |
| End to end | `make test-e2e` | Playwright plays a round in the built game against the binary and kind: place a factory via the cameo and form, order a unit, sell a unit, repair a unit, sell the structure with confirm; asserted via the store and kubectl | ~10 s |

Rule of thumb when adding behaviour: put the decision in a pure module under
`web/src/game` or `internal/kube` with a unit test, keep the Phaser scene a
thin renderer of it, and extend the e2e round only when a new player action
appears.

---

## 7. Risks and mitigations

| Risk                                              | Mitigation                                                                 |
|---------------------------------------------------|----------------------------------------------------------------------------|
| Using EA assets by accident                       | All art and audio original; a `web/public/assets/SOURCES.md` records provenance. |
| Helm SDK breaking between minors                  | Pin in go.mod; wrapper confines SDK calls to one package.                  |
| Large clusters flood the map                      | v1 informers are cluster-wide but the map renders a namespace allow-list; later, server-side namespace filtering. |
| Canvas text input                                 | Forms in a styled DOM overlay from day one.                                |
| Phaser 4 shipping mid-project                     | Stay on Phaser 3.x; entities wrap Phaser objects so an upgrade is contained. |
| Two languages drift                               | OpenAPI codegen on both sides, run in `make gen` and checked in CI.         |

---

## 8. Remaining open questions

These do not block Phase 0-2 and can be answered when they come up.

1. Should the map be one plateau per node, or should small clusters (one kind
   node) get a few artificial sectors so the base has room to spread?
   Default: one plateau per node, with minimum plateau size.
2. Namespace creation from the game, or only choosing existing namespaces in
   the create form? Default: existing only until Phase 4.
3. Should "Sell unit" scale down (replicas -1) or just delete the pod and let
   the ReplicaSet replace it? Default: scale down; "Repair" is the delete-and-
   replace action.
