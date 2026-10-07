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

Controls: left-click selects, drag box-selects units, drag a structure to
move it, right-drag pans, wheel zooms, arrows or WASD scroll, H homes the
camera, N toggles system namespaces, B (or the WAR FACTORY cameo) starts
placing a Deployment, Esc cancels or clears. Click the radar to jump.

Playing: place a War Factory on a free cell in a plateau's top rows and fill
in the form to create a Deployment. Select the factory to build or retire
units (scale replicas). Select units and SELL to scale down retiring exactly
those pods. The power bar is CPU requests over allocatable across ready nodes.

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
make test-kind # integration test against the kind cluster
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
