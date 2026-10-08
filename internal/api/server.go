// Package api wires the generated OpenAPI server interface to real handlers,
// serves the WebSocket event stream, and serves the embedded frontend for
// every other path.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/ericomanoff/harbor/internal/api/gen"
	"github.com/ericomanoff/harbor/internal/assets"
	"github.com/ericomanoff/harbor/internal/helm"
	"github.com/ericomanoff/harbor/internal/kube"
)

// Version is set at build time via -ldflags "-X .../internal/api.Version=...".
var Version = "dev"

// selectTimeout bounds connecting to a cluster and syncing informer caches.
const selectTimeout = 30 * time.Second

// Server implements gen.ServerInterface and owns the active cluster watcher.
type Server struct {
	started time.Time
	hub     *kube.Hub

	// Injection points for tests.
	listContexts func() ([]gen.KubeContext, string, error)
	newWatcher   func(ctx context.Context, name string, hub *kube.Hub) (*kube.Watcher, error)
	newHelm      func(contextName string) *helm.Client

	mu      sync.Mutex
	watcher *kube.Watcher
	helm    *helm.Client
}

var _ gen.ServerInterface = (*Server)(nil)

// NewServer returns a server with no context selected.
func NewServer() *Server {
	return &Server{
		started:      time.Now(),
		hub:          kube.NewHub(),
		listContexts: kube.ListContexts,
		newWatcher:   connectWatcher,
		newHelm:      helm.New,
	}
}

// NewHandler is a convenience for callers that need no handle on the Server.
func NewHandler() http.Handler {
	return NewServer().Handler()
}

// Handler returns the root handler: API routes, the WebSocket, then assets.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	gen.HandlerFromMux(s, mux)
	mux.HandleFunc("GET /ws", s.handleWS)
	mux.Handle("/", assets.Handler())
	return mux
}

// connectWatcher is the production newWatcher: build a clientset, ping the
// API server, then start informers and wait for sync.
func connectWatcher(ctx context.Context, name string, hub *kube.Hub) (*kube.Watcher, error) {
	cs, err := kube.NewClientset(name)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := kube.Ping(pingCtx, cs); err != nil {
		return nil, fmt.Errorf("cannot reach cluster for context %q: %w", name, err)
	}
	w := kube.NewWatcher(name, cs, hub)
	if err := w.Start(ctx); err != nil {
		return nil, err
	}
	return w, nil
}

// SelectContextByName connects to the named context (empty means the
// kubeconfig's current context), swaps it in as the active watcher, and
// broadcasts a fresh snapshot to every connected client.
func (s *Server) SelectContextByName(ctx context.Context, name string) error {
	if name == "" {
		_, current, err := s.listContexts()
		if err != nil {
			return err
		}
		if current == "" {
			return errors.New("kubeconfig has no current-context; pass -context or pick one in the UI")
		}
		name = current
	}
	w, err := s.newWatcher(ctx, name, s.hub)
	if err != nil {
		return err
	}
	s.mu.Lock()
	old := s.watcher
	s.watcher = w
	s.helm = s.newHelm(name)
	s.mu.Unlock()
	if old != nil {
		old.Stop()
	}
	log.Printf("watching context %q", name)
	s.hub.Publish(kube.NewMessage(gen.WsMessageTypeSnapshot, w.Snapshot()))
	return nil
}

// Close stops the active watcher.
func (s *Server) Close() {
	s.mu.Lock()
	w := s.watcher
	s.watcher = nil
	s.mu.Unlock()
	if w != nil {
		w.Stop()
	}
}

func (s *Server) current() *kube.Watcher {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.watcher
}

func (s *Server) currentHelm() *helm.Client {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.helm
}

// snapshot returns the active cluster state, or an empty snapshot with no
// context when nothing is selected yet.
func (s *Server) snapshot() gen.Snapshot {
	if w := s.current(); w != nil {
		return w.Snapshot()
	}
	return gen.Snapshot{
		Nodes:       []gen.Node{},
		Namespaces:  []gen.Namespace{},
		Deployments: []gen.Deployment{},
		Pods:        []gen.Pod{},
		Releases:    []gen.HelmRelease{},
		Services:    []gen.Service{},
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, gen.Error{Message: msg})
}

// GetHealth reports liveness, version and uptime.
func (s *Server) GetHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, gen.Health{
		Status:        gen.Ok,
		Version:       Version,
		UptimeSeconds: int(time.Since(s.started).Seconds()),
	})
}

// ListContexts lists kubeconfig contexts and names the one being watched.
func (s *Server) ListContexts(w http.ResponseWriter, _ *http.Request) {
	ctxs, _, err := s.listContexts()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	current := ""
	if cur := s.current(); cur != nil {
		current = cur.Context
	}
	writeJSON(w, http.StatusOK, gen.ContextList{Contexts: ctxs, Current: current})
}

// SelectContext switches the backend to watch another cluster.
func (s *Server) SelectContext(w http.ResponseWriter, r *http.Request, name gen.ContextNameParam) {
	ctx, cancel := context.WithTimeout(r.Context(), selectTimeout)
	defer cancel()
	if err := s.SelectContextByName(ctx, name); err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
		}
		writeError(w, status, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetSnapshot returns the full cluster state for a fresh client.
func (s *Server) GetSnapshot(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.snapshot())
}
