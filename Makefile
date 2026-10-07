# harbor: Command & Conquer style GUI for Kubernetes and Helm.
#
#   make dev       run Go backend + Vite dev server with hot reload (http://127.0.0.1:5173)
#   make run       build everything and serve from the Go binary (http://127.0.0.1:8080)
#   make gen       regenerate Go and TypeScript code from api/openapi.yaml
#   make test      Go tests + frontend tests
#   make test-kind integration test against the kind cluster
#   make test-e2e  Playwright plays a round in the real game against kind
#   make kind-up   create the local kind cluster with a sample workload
#   make kind-down delete it

BIN      := bin/harbor
VERSION  ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS  := -X github.com/ericomanoff/harbor/internal/api.Version=$(VERSION)
KIND_CLUSTER := harbor

.PHONY: all gen web build run dev test test-go test-web test-kind test-e2e kind-up kind-down clean deps

all: build

deps: web/node_modules

web/node_modules: web/package.json web/package-lock.json
	cd web && npm ci
	@touch web/node_modules

gen: deps
	go tool oapi-codegen -config oapi-codegen.yaml api/openapi.yaml
	cd web && npm run gen

web: deps
	cd web && npm run build

build: web
	go build -ldflags '$(LDFLAGS)' -o $(BIN) ./cmd/harbor

run: build
	./$(BIN)

# Backend on :8080, Vite on :5173 proxying /api and /ws to it. Ctrl-C stops both.
dev: deps
	@trap 'kill 0' EXIT INT TERM; \
	go run -ldflags '$(LDFLAGS)' ./cmd/harbor & \
	cd web && npm run dev; \
	wait

test: test-go test-web

test-go:
	go vet ./...
	go test ./...

test-web: deps
	cd web && npm run typecheck && npm test

# Integration test against the kind cluster from `make kind-up`.
test-kind:
	HARBOR_KIND_TEST=1 go test ./internal/kube -run TestIntegrationKind -v -count=1

# End-to-end: Playwright drives the built game against the binary and kind.
test-e2e: build
	cd web && npx playwright test

kind-up:
	kind create cluster --name $(KIND_CLUSTER) --config deploy/kind/kind-config.yaml
	kubectl --context kind-$(KIND_CLUSTER) apply -f deploy/kind/sample-workloads.yaml
	kubectl --context kind-$(KIND_CLUSTER) rollout status deployment/nginx -n sandbox --timeout=120s

kind-down:
	kind delete cluster --name $(KIND_CLUSTER)

clean:
	rm -rf bin internal/assets/dist/* web/dist
	@touch internal/assets/dist/.gitkeep
