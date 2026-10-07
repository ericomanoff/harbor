package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

func TestGetHealth(t *testing.T) {
	h := NewHandler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/healthz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", rec.Code, rec.Body.String())
	}
	var got gen.Health
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Status != gen.Ok {
		t.Errorf("status = %q, want ok", got.Status)
	}
}

func TestUnimplementedRoutesAnswer501(t *testing.T) {
	h := NewHandler()
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/contexts"},
		{http.MethodPost, "/api/contexts/kind-harbor/select"},
		{http.MethodGet, "/api/snapshot"},
		{http.MethodPost, "/api/deployments"},
		{http.MethodPatch, "/api/deployments/default/web/scale"},
		{http.MethodPatch, "/api/deployments/default/web/mappos"},
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
		if rec.Code != http.StatusNotImplemented {
			t.Errorf("%s %s: status = %d, want 501", tc.method, tc.path, rec.Code)
		}
	}
}

func TestRootServesFrontendOrPlaceholder(t *testing.T) {
	h := NewHandler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}
