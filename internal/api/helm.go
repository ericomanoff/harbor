package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/storage/driver"

	"github.com/ericomanoff/harbor/internal/api/gen"
	"github.com/ericomanoff/harbor/internal/helm"
)

// Helm operations can pull charts and wait on hooks.
const helmTimeout = 5 * time.Minute

func (s *Server) helmOr409(w http.ResponseWriter) (*helm.Client, bool) {
	h := s.currentHelm()
	if h == nil {
		writeError(w, http.StatusConflict, "no context selected")
		return nil, false
	}
	return h, true
}

func writeHelmError(w http.ResponseWriter, err error) {
	var ve *helm.ValidationError
	switch {
	case errors.As(err, &ve):
		writeError(w, http.StatusBadRequest, ve.Msg)
	case errors.Is(err, driver.ErrReleaseNotFound), errors.Is(err, driver.ErrNoDeployedReleases):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, driver.ErrReleaseExists), strings.Contains(err.Error(), "still in use"):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeKubeError(w, err)
	}
}

func (s *Server) ListHelmRepos(w http.ResponseWriter, _ *http.Request) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	repos, err := h.ListRepos()
	if err != nil {
		writeHelmError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, repos)
}

func (s *Server) AddHelmRepo(w http.ResponseWriter, r *http.Request) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	var req gen.HelmRepo
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), helmTimeout)
	defer cancel()
	if err := h.AddRepo(ctx, req.Name, req.Url); err != nil {
		writeHelmError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) UpdateHelmRepos(w http.ResponseWriter, r *http.Request) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), helmTimeout)
	defer cancel()
	if err := h.UpdateRepos(ctx); err != nil {
		writeHelmError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) SearchHelmCharts(w http.ResponseWriter, _ *http.Request, params gen.SearchHelmChartsParams) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	q := ""
	if params.Q != nil {
		q = *params.Q
	}
	charts, err := h.SearchCharts(q)
	if err != nil {
		writeHelmError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, charts)
}

func (s *Server) GetHelmChartValues(w http.ResponseWriter, _ *http.Request, params gen.GetHelmChartValuesParams) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	version := ""
	if params.Version != nil {
		version = *params.Version
	}
	vals, err := h.ChartValues(params.Chart, version)
	if err != nil {
		writeHelmError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, vals)
}

func (s *Server) ListHelmReleases(w http.ResponseWriter, _ *http.Request) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	rels, err := h.ListReleases()
	if err != nil {
		writeHelmError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rels)
}

func (s *Server) InstallHelmRelease(w http.ResponseWriter, r *http.Request) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	var req gen.HelmInstallRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), helmTimeout)
	defer cancel()
	rel, err := h.Install(ctx, req)
	if err != nil {
		writeHelmError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, rel)
}

func (s *Server) UninstallHelmRelease(w http.ResponseWriter, _ *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	if err := h.Uninstall(ns, name); err != nil {
		writeHelmError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) GetHelmReleaseHistory(w http.ResponseWriter, _ *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	hist, err := h.History(ns, name)
	if err != nil {
		writeHelmError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, hist)
}

func (s *Server) UpgradeHelmRelease(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	var req gen.HelmUpgradeRequest
	if !decode(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), helmTimeout)
	defer cancel()
	rel, err := h.Upgrade(ctx, ns, name, req)
	if err != nil {
		writeHelmError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rel)
}

func (s *Server) RollbackHelmRelease(w http.ResponseWriter, r *http.Request, ns gen.NamespaceParam, name gen.NameParam) {
	h, ok := s.helmOr409(w)
	if !ok {
		return
	}
	var req gen.HelmRollbackRequest
	if !decode(w, r, &req) {
		return
	}
	if err := h.Rollback(ns, name, req.Revision); err != nil {
		writeHelmError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
