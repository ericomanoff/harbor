// Package api wires the generated OpenAPI server interface to real handlers
// and serves the embedded frontend for every other path.
package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/ericomanoff/harbor/internal/api/gen"
	"github.com/ericomanoff/harbor/internal/assets"
)

// Version is set at build time via -ldflags "-X .../internal/api.Version=...".
var Version = "dev"

// Server implements gen.ServerInterface. Cluster-backed methods arrive in
// Phase 1; until then they answer 501 so the contract is visible end to end.
type Server struct {
	started time.Time
}

var _ gen.ServerInterface = (*Server)(nil)

// NewHandler returns the root handler: API routes first, then static assets.
func NewHandler() http.Handler {
	s := &Server{started: time.Now()}
	mux := http.NewServeMux()
	gen.HandlerFromMux(s, mux)
	mux.Handle("/", assets.Handler())
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, gen.Error{Message: msg})
}

func notImplemented(w http.ResponseWriter) {
	writeError(w, http.StatusNotImplemented, "not implemented yet")
}

// GetHealth reports liveness, version and uptime.
func (s *Server) GetHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, gen.Health{
		Status:        gen.Ok,
		Version:       Version,
		UptimeSeconds: int(time.Since(s.started).Seconds()),
	})
}

func (s *Server) ListContexts(w http.ResponseWriter, _ *http.Request) { notImplemented(w) }

func (s *Server) SelectContext(w http.ResponseWriter, _ *http.Request, _ gen.ContextNameParam) {
	notImplemented(w)
}

func (s *Server) GetSnapshot(w http.ResponseWriter, _ *http.Request) { notImplemented(w) }

func (s *Server) CreateDeployment(w http.ResponseWriter, _ *http.Request) { notImplemented(w) }

func (s *Server) ScaleDeployment(w http.ResponseWriter, _ *http.Request, _ gen.NamespaceParam, _ gen.NameParam) {
	notImplemented(w)
}

func (s *Server) SetDeploymentMapPos(w http.ResponseWriter, _ *http.Request, _ gen.NamespaceParam, _ gen.NameParam) {
	notImplemented(w)
}
