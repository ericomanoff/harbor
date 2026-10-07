package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ericomanoff/harbor/internal/api/gen"
	"github.com/ericomanoff/harbor/internal/helm"
	"github.com/ericomanoff/harbor/internal/helm/helmtest"
)

func TestHelmRoutesRequireAContext(t *testing.T) {
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/helm/releases", nil))
	if rec.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", rec.Code)
	}
}

func TestHelmRoundTrip(t *testing.T) {
	s := fakeServer(t)
	hc, repoURL := helmtest.NewClient(t, helmtest.ChartDir(t))
	s.newHelm = func(string) *helm.Client { return hc }
	if err := s.SelectContextByName(context.Background(), "kind-harbor"); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rec, req)
		return rec
	}

	if rec := do(http.MethodPost, "/api/helm/repos", `{"name":"test","url":"`+repoURL+`"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("add repo: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodPost, "/api/helm/repos", `{"name":"bad name","url":"x"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("bad repo name: %d, want 400", rec.Code)
	}
	rec := do(http.MethodGet, "/api/helm/repos", "")
	var repos []gen.HelmRepo
	if err := json.Unmarshal(rec.Body.Bytes(), &repos); err != nil || len(repos) != 1 || repos[0].Name != "test" {
		t.Fatalf("repos: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodPost, "/api/helm/repos/update", ""); rec.Code != http.StatusNoContent {
		t.Errorf("update: %d", rec.Code)
	}

	rec = do(http.MethodGet, "/api/helm/charts?q=rad", "")
	var charts []gen.HelmChart
	if err := json.Unmarshal(rec.Body.Bytes(), &charts); err != nil || len(charts) != 1 || charts[0].Name != "radar" {
		t.Fatalf("charts: %d %s", rec.Code, rec.Body.String())
	}
	rec = do(http.MethodGet, "/api/helm/charts/values?chart=test/radar", "")
	var vals gen.HelmValues
	if err := json.Unmarshal(rec.Body.Bytes(), &vals); err != nil || !strings.Contains(vals.Values, "replicaCount") {
		t.Fatalf("values: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodGet, "/api/helm/charts/values?chart=test/nope", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("unknown chart: %d, want 400", rec.Code)
	}

	rec = do(http.MethodPost, "/api/helm/releases", `{"ns":"sandbox","name":"outpost","chart":"test/radar","values":"replicaCount: 2"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("install: %d %s", rec.Code, rec.Body.String())
	}
	var rel gen.HelmRelease
	if err := json.Unmarshal(rec.Body.Bytes(), &rel); err != nil || rel.Revision != 1 || rel.Status != "deployed" {
		t.Fatalf("installed = %+v (%v)", rel, err)
	}
	if rec := do(http.MethodPost, "/api/helm/releases", `{"ns":"sandbox","name":"outpost","chart":"test/radar"}`); rec.Code != http.StatusConflict {
		t.Errorf("duplicate install: %d, want 409", rec.Code)
	}

	rec = do(http.MethodGet, "/api/helm/releases", "")
	var rels []gen.HelmRelease
	if err := json.Unmarshal(rec.Body.Bytes(), &rels); err != nil || len(rels) != 1 {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}

	if rec := do(http.MethodPost, "/api/helm/releases/sandbox/outpost/upgrade", `{"chart":"test/radar","values":"replicaCount: 3"}`); rec.Code != http.StatusOK {
		t.Fatalf("upgrade: %d %s", rec.Code, rec.Body.String())
	}
	rec = do(http.MethodGet, "/api/helm/releases/sandbox/outpost/history", "")
	var hist []gen.HelmRevision
	if err := json.Unmarshal(rec.Body.Bytes(), &hist); err != nil || len(hist) != 2 {
		t.Fatalf("history: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodPost, "/api/helm/releases/sandbox/outpost/rollback", `{"revision":1}`); rec.Code != http.StatusNoContent {
		t.Fatalf("rollback: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodGet, "/api/helm/releases/sandbox/ghost/history", ""); rec.Code != http.StatusNotFound {
		t.Errorf("history of missing release: %d, want 404", rec.Code)
	}
	if rec := do(http.MethodDelete, "/api/helm/releases/sandbox/outpost", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("uninstall: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodDelete, "/api/helm/releases/sandbox/outpost", ""); rec.Code != http.StatusNotFound {
		t.Errorf("uninstall twice: %d, want 404", rec.Code)
	}
}
