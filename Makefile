# harbor: Command & Conquer style GUI for Kubernetes and Helm.
#
#   make dev       run Go backend + Vite dev server with hot reload (http://127.0.0.1:5173)
#   make run       build everything and serve from the Go binary (http://127.0.0.1:8080)
#   make gen       regenerate Go and TypeScript code from api/openapi.yaml
#   make test      Go tests + frontend tests
#   make test-kind integration test against the kind cluster
#   make test-e2e  Playwright plays a round in the real game against kind
#   make test-visual  screenshot regression of ?style and ?demo (baselines per machine)
#   make dist      cross-compile binaries for macOS, Linux and Windows into dist/
#   make kind-up   create the local kind cluster with a sample workload
#   make kind-down delete it

BIN      := bin/harbor
VERSION  ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS  := -X github.com/ericomanoff/harbor/internal/api.Version=$(VERSION)
KIND_CLUSTER := harbor

.PHONY: all gen web build run dev test test-go test-web test-kind test-e2e test-visual test-visual-update kind-up kind-down clean deps dist

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
	HARBOR_KIND_TEST=1 go test ./internal/kube -run "TestIntegrationKind" -v -count=1

# End-to-end: Playwright drives the built game against the binary and kind.
test-e2e: build
	cd web && npx playwright test game.spec.ts tour.spec.ts glossary.spec.ts levels.spec.ts levels-real.spec.ts campaign.spec.ts features.spec.ts

# Visual snapshots of the style page and the demo harbor (no cluster needed).
# Baselines are per machine: run test-visual-update once where tests will run.
test-visual: build
	cd web && npx playwright test visual.spec.ts
test-visual-update: build
	cd web && npx playwright test visual.spec.ts --update-snapshots

kind-up:
	kind create cluster --name $(KIND_CLUSTER) --config deploy/kind/kind-config.yaml
	kubectl --context kind-$(KIND_CLUSTER) apply -f deploy/kind/sample-workloads.yaml
	kubectl --context kind-$(KIND_CLUSTER) rollout status deployment/nginx -n sandbox --timeout=120s

kind-down:
	kind delete cluster --name $(KIND_CLUSTER)

# Cross-compile single binaries with the embedded frontend.
PLATFORMS := darwin/arm64 darwin/amd64 linux/amd64 linux/arm64 windows/amd64
dist: web
	@mkdir -p dist
	@for p in $(PLATFORMS); do \
		os=$${p%/*}; arch=$${p#*/}; ext=""; [ $$os = windows ] && ext=.exe; \
		echo "  $$os/$$arch"; \
		GOOS=$$os GOARCH=$$arch CGO_ENABLED=0 go build -trimpath -ldflags '-s -w $(LDFLAGS)' -o dist/harbor-$$os-$$arch$$ext ./cmd/harbor || exit 1; \
	done
	@ls -la dist

clean:
	rm -rf bin dist internal/assets/dist/* web/dist
	@touch internal/assets/dist/.gitkeep
