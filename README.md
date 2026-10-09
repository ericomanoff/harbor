# harbor

A Command & Conquer style GUI for Kubernetes and Helm. Deployments are
production structures, pods are units, nodes are plateaus, and the power bar is
your cluster's allocatable capacity. See `PLAN.md` for the full design and
phase plan.

## Stack

- Frontend: Phaser 3, TypeScript, Vite (`web/`)
- Backend: Go, client-go informers, Helm Go SDK (`cmd/`, `internal/`)
- Contract: `api/openapi.yaml`, code generated on both sides by `make gen`
- Single binary: the built frontend is embedded via `internal/assets`

## Quick start

```sh
make kind-up   # local 3-node kind cluster with sample workloads (needs Docker)
make dev       # backend on :8080, Vite with hot reload on :5173
```

Open http://127.0.0.1:5173. Add `?demo` to the URL to run against a built-in
fake cluster with no backend.

The map is a harbor: each node is an island dock, Deployments are shipyards
on the land, pods are ships moored in the shallows, Services are lighthouses,
Helm releases are anchorages ringed by a mooring boom. StatefulSets are
tanker terminals launching numbered tankers, DaemonSets are tug companies
with one tugboat per dock, Jobs are fishing fleets that come home when the
catch is landed. Ingresses are gates in the breakwater at the harbor mouth;
select one to see the channels to the lighthouses it routes to.

Every harbor word and every Kubernetes word in the interface has a tooltip:
hover for the pairing ("Shipyard = Deployment") and a one-liner, click or press
G for the glossary. Settings can show both languages everywhere.

The loading screen hails the backend first; if no harbor answers it offers
Retry or the demo harbor. The first visit starts a welcome tour in a training harbor (nothing touches
your cluster); replay it any time with the Help button, or add `?notour` to
the URL to suppress it.

Harbor Academy (the Academy button, or `?academy`) teaches Kubernetes one
idea per level in the training harbor: something goes wrong, the harbor
master guides you through the fix with the normal forms, the same thing
happens again and is handled, fireworks, then a summary card that maps the
harbor words to Kubernetes and to a real on-call situation, with the YAML and
kubectl equivalent. Levels award up to three stars (finished, no hints, under
par); progress is kept in `~/.config/harbor/progress.json` (`-progress` to
move it). `?level=academy/2` opens a level directly. Levels so far: 1 "A ship
and its cargo" (pods and containers), 2 "The shipyard" (Deployments), 3 "Storm
season" (scaling), 4 "Lookouts" (readiness and liveness probes), 5 "The
lighthouse" (Services), 6 "The harbor mouth" (Ingress), 7 "Sealed orders"
(ConfigMaps and Secrets), 8 "Berths and cargo" (requests and limits), 9
"Fleets and ensigns" (namespaces and labels), 10 "Refit at sea" (rolling
updates and rollback).

Controls: left-click selects, drag box-selects ships, drag a shipyard to move
it, right-drag pans, wheel or the right rail zooms, arrows or WASD scroll, H
or the home button fits the harbor, Shop (or B) starts placing a shipyard,
Charts (or T) opens the Helm chart table, the harbor badge (or C) changes
context, Find (or `/`) locates, Fleets (or F) filters namespaces, the bell
(or M) toggles sound, Tab cycles the selection, Esc cancels or clears. The
selection card at the bottom carries the actions for whatever is selected.

Playing: open the Shop, Build a shipyard (Deployment) or a tanker terminal
(StatefulSet with its headless Service and an optional volume per tanker) on
a free slipway (the land rows of an island) and fill in the form; a shipyard
form takes readiness and liveness lookouts (HTTP probes), CPU and memory
limits, sealed orders to inject as environment, and shows the YAML it will
produce under Ship's manifest. Fishing fleet sends out a Job (command,
catches, boats at sea, retries). The Harbor tab opens a gate (an Ingress with
one host and path pointing at a lighthouse), lights a lighthouse (a Service
whose selector follows a fleet's labels), seals orders (a ConfigMap or
Secret from KEY=value lines; Secret values never come back to the browser)
or founds a new fleet (a Namespace). Select the shipyard
to Launch or Scrap ships (scale replicas), Sell it (confirm twice), Refit it
(a rollout to a new image, with max unavailable and max surge) or Roll back
the last refit (rollout undo). Select
ships to Scrap exactly those pods, Refit them (delete so the ReplicaSet
replaces them), or read the Ship's log. Ships from an old rollout look
weathered; crash-looping ships burn; Warning events flash their ship or
shipyard. BERTHS is CPU requests over allocatable, CARGO is memory, CREW is
ships ready.

Lighthouses stand near the ships they route to; select either side to see
the beam lines. Helm: open Charts, add a chart library under REPOS (for
example `podinfo` at https://stefanprodan.github.io/podinfo), pick a chart and
Build it: the release's shipyards appear inside a mooring boom. Click the
boom's nameplate to Upgrade, Roll back or Weigh anchor (uninstall).
Repositories are read from and written to Helm's usual config paths.

For the single-binary experience:

```sh
make run       # builds web + Go, serves on http://127.0.0.1:8080
```

The binary connects to your kubeconfig's current context at startup. Flags:
`-context NAME` watches another context, `-no-connect` waits for the UI to
pick one, `-addr` changes the loopback address. Watch the raw event stream:

```sh
websocat ws://127.0.0.1:8080/ws
```

## Development

```sh
make gen       # after editing api/openapi.yaml
make test      # go vet + go test + tsc + vitest
make test-kind # integration test against the kind cluster (~5 s)
make test-e2e  # Playwright plays a round in the real game against kind (~20 s)
make test-visual # screenshot regression of ?style and ?demo (baselines per machine)
cd web && npx playwright test tour.spec.ts levels.spec.ts  # the welcome tour and the academy levels (no cluster needed)
make dist      # single binaries for macOS, Linux and Windows in dist/
make kind-down
```

The server binds loopback only. It runs with your kubeconfig, so never expose
it on a network interface.

## Layout

```
cmd/harbor/           entrypoint
internal/api/         handlers; internal/api/gen is generated, do not edit
internal/assets/      go:embed of the Vite build (internal/assets/dist)
api/openapi.yaml      API contract
web/src/scenes/       Phaser scenes
web/src/api/          generated schema.ts and a thin client
deploy/kind/          kind cluster config and sample workloads
```
