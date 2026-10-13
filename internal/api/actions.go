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
	"github.com/ericomanoff/harbor/internal/campaign"
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

// RefitDeployment starts a rollout with a new image (and strategy).
func (s *Server) RefitDeployment(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.RefitRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.RefitDeployment(ctx, cur.Client(), ns, name, req); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RollbackDeployment is rollout undo.
func (s *Server) RollbackDeployment(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.RollbackDeployment(ctx, cur.Client(), ns, name); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListCampaigns: the expeditions, built in and from the user's campaigns directory.
func (s *Server) ListCampaigns(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	cs := s.campaigns
	s.mu.Unlock()
	if cs == nil {
		cs = []gen.Campaign{}
	}
	writeJSON(w, http.StatusOK, cs)
}

// RunProbe runs one whitelisted check against the connected cluster.
func (s *Server) RunProbe(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.ProbeRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	res, err := campaign.Run(ctx, cur.Client(), req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// GetObject: an object's papers (spec, status, metadata, managers).
func (s *Server) GetObject(w http.ResponseWriter, r *http.Request, kind gen.GetObjectParamsKind, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	out, err := kube.Papers(ctx, cur.Client(), string(kind), ns, name)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// ApplyManifest: server-side apply of whitelisted kinds, dry-run for the diff.
func (s *Server) ApplyManifest(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.ApplyRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	out, err := kube.Apply(ctx, cur.Client(), req)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) PatchPodLabels(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.LabelPatch
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.PatchPodLabels(ctx, cur.Client(), ns, name, req); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) PatchDeploymentLabels(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.LabelPatch
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.PatchDeploymentLabels(ctx, cur.Client(), ns, name, req); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// StageIncident performs one whitelisted academy incident on the real cluster.
func (s *Server) StageIncident(w http.ResponseWriter, r *http.Request, incident gen.StageIncidentParamsIncident) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.StageRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	res, err := kube.Stage(ctx, cur.Client(), string(incident), req)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, res)
}

func (s *Server) CreateNamespace(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.CreateNamespaceRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	ns, err := kube.CreateNamespace(ctx, cur.Client(), req.Name)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, kube.ConvertNamespace(ns))
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

func (s *Server) ScaleWorkload(w http.ResponseWriter, r *http.Request, kind gen.ScaleWorkloadParamsKind, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	if string(kind) != string(gen.WorkloadKindStatefulSet) {
		writeError(w, http.StatusBadRequest, "only StatefulSets can be scaled")
		return
	}
	var req gen.ScaleRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.ScaleStatefulSet(ctx, cur.Client(), ns, name, req.Replicas); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) DeleteWorkload(w http.ResponseWriter, r *http.Request, kind gen.DeleteWorkloadParamsKind, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.DeleteWorkload(ctx, cur.Client(), gen.WorkloadKind(kind), ns, name); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) SetWorkloadMapPos(w http.ResponseWriter, r *http.Request, kind gen.SetWorkloadMapPosParamsKind, ns gen.NamespaceParam, name gen.NameParam) {
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
	if err := kube.SetWorkloadMapPos(ctx, cur.Client(), gen.WorkloadKind(kind), ns, name, mp); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteIngress closes a gate at the harbor mouth.
func (s *Server) DeleteIngress(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.DeleteIngress(ctx, cur.Client(), ns, name); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) ListOrders(w http.ResponseWriter, r *http.Request, params gen.ListOrdersParams) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	out, err := kube.ListOrders(ctx, cur.Client(), params.Ns)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) CreateOrders(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.CreateOrdersRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	out, err := kube.CreateOrders(ctx, cur.Client(), req)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) DeleteOrders(w http.ResponseWriter, r *http.Request, kind gen.DeleteOrdersParamsKind, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.DeleteOrders(ctx, cur.Client(), gen.OrdersKind(kind), ns, name); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) CreateService(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.CreateServiceRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	svc, err := kube.CreateService(ctx, cur.Client(), req)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, kube.ConvertService(svc))
}

func (s *Server) DeleteService(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	if err := kube.DeleteService(ctx, cur.Client(), ns, name); err != nil {
		writeKubeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) CreateStatefulSet(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.CreateStatefulSetRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	ss, err := kube.CreateStatefulSet(ctx, cur.Client(), req)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, kube.ConvertStatefulSet(ss))
}

func (s *Server) CreateIngress(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.CreateIngressRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	ing, err := kube.CreateIngress(ctx, cur.Client(), req)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, kube.ConvertIngress(ing))
}

func (s *Server) CreateJob(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.clientOr409(w)
	if !ok {
		return
	}
	var req gen.CreateJobRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), actionTimeout)
	defer cancel()
	job, err := kube.CreateJob(ctx, cur.Client(), req)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, kube.ConvertJob(job))
}

func (s *Server) GetProgress(w http.ResponseWriter, _ *http.Request) {
	p, err := s.progress.Load()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) ResetProgress(w http.ResponseWriter, _ *http.Request) {
	if err := s.progress.Reset(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) PutLevelProgress(w http.ResponseWriter, r *http.Request, level string) {
	var req gen.LevelProgress
	if !decode(w, r, &req) {
		return
	}
	p, err := s.progress.Record(level, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}
