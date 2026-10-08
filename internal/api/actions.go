package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/ericomanoff/harbor/internal/api/gen"
	"github.com/ericomanoff/harbor/internal/kube"
)

const actionTimeout = 15 * time.Second

// clientOr409 returns the active cluster client or writes a 409.
func (s *Server) clientOr409(w http.ResponseWriter) (*kube.Watcher, bool) {
	cur := s.current()
	if cur == nil {
		writeError(w, http.StatusConflict, "no context selected")
		return nil, false
	}
	return cur, true
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "bad request body: "+err.Error())
		return false
	}
	return true
}

// writeKubeError maps validation and API server errors to HTTP statuses.
func writeKubeError(w http.ResponseWriter, err error) {
	var ve *kube.ValidationError
	switch {
	case errors.As(err, &ve):
		writeError(w, http.StatusBadRequest, ve.Msg)
	case apierrors.IsNotFound(err):
		writeError(w, http.StatusNotFound, err.Error())
	case apierrors.IsAlreadyExists(err):
		writeError(w, http.StatusConflict, err.Error())
	case apierrors.IsInvalid(err), apierrors.IsBadRequest(err):
		writeError(w, http.StatusBadRequest, err.Error())
	case apierrors.IsForbidden(err), apierrors.IsUnauthorized(err):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, context.DeadlineExceeded):
		writeError(w, http.StatusGatewayTimeout, err.Error())
	default:
		writeError(w, http.StatusBadGateway, err.Error())
	}
}

// CreateDeployment places a War Factory.
func (s *Server) CreateDeployment(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.CreateDeploymentRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	d, err := kube.CreateDeployment(ctx, cur.Client(), req)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, kube.ConvertDeployment(d))
}

// ScaleDeployment builds or sells units.
func (s *Server) ScaleDeployment(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.ScaleRequest
	if !decode(w, r, &req) {
		return
	}
	var retire []string
	if req.RetireFirst != nil {
		retire = *req.RetireFirst
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.ScaleDeployment(ctx, cur.Client(), ns, name, req.Replicas, retire); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SetDeploymentMapPos persists where the player put the building.
func (s *Server) SetDeploymentMapPos(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var mp gen.MapPos
	if !decode(w, r, &mp) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.SetMapPos(ctx, cur.Client(), ns, name, mp); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteDeployment sells a structure.
func (s *Server) DeleteDeployment(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.DeleteDeployment(ctx, cur.Client(), ns, name); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeletePod repairs a unit by letting its ReplicaSet replace it.
func (s *Server) DeletePod(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.DeletePod(ctx, cur.Client(), ns, name); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetPodLogs returns the tail of a pod's log as plain text.
func (s *Server) GetPodLogs(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam, params gen.GetPodLogsParams) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	container := ""
	if params.Container != nil {
		container = *params.Container
	}
	tail := int64(200)
	if params.Tail != nil {
		tail = int64(*params.Tail)
		if tail < 1 || tail > 5000 {
			writeError(w, http.StatusBadRequest, "tail must be 1-5000")
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	rc, err := kube.PodLogs(ctx, cur.Client(), ns, name, container, tail)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
}
