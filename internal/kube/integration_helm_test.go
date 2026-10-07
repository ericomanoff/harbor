package kube

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/repo"

	"github.com/ericomanoff/harbor/internal/api/gen"
	"github.com/ericomanoff/harbor/internal/helm"
)

// TestIntegrationKindHelm installs the test chart into the kind cluster
// through the real Helm SDK (secrets driver) and checks the release shows up
// on the stream via its storage secret. Skipped unless HARBOR_KIND_TEST=1.
func TestIntegrationKindHelm(t *testing.T) {
	if os.Getenv("HARBOR_KIND_TEST") != "1" {
		t.Skip("set HARBOR_KIND_TEST=1 to run against the kind cluster")
	}
	ctxName := os.Getenv("HARBOR_KIND_CONTEXT")
	if ctxName == "" {
		ctxName = "kind-harbor"
	}
	// Keep Helm's repo config out of the user's real one.
	dir := t.TempDir()
	t.Setenv("HELM_REPOSITORY_CONFIG", filepath.Join(dir, "repositories.yaml"))
	t.Setenv("HELM_REPOSITORY_CACHE", filepath.Join(dir, "cache"))

	// Serve the test chart as a repository.
	ch, err := loader.Load(filepath.Join("..", "helm", "testdata", "charts", "radar"))
	if err != nil {
		t.Fatal(err)
	}
	repoDir := filepath.Join(dir, "repo")
	if err := os.MkdirAll(repoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := chartutil.Save(ch, repoDir); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.FileServer(http.Dir(repoDir)))
	defer srv.Close()
	idx, err := repo.IndexDirectory(repoDir, srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if err := idx.WriteFile(filepath.Join(repoDir, "index.yaml"), 0o644); err != nil {
		t.Fatal(err)
	}

	client, err := NewClientset(ctxName)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	hub := NewHub()
	w := NewWatcher(ctxName, client, hub)
	if err := w.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer w.Stop()
	ch2, unsub := hub.Subscribe(1024)
	defer unsub()

	hc := helm.New(ctxName)
	const ns, name = "sandbox", "harbor-it-helm"
	_ = hc.Uninstall(ns, name) // leftover from a failed run
	t.Cleanup(func() { _ = hc.Uninstall(ns, name) })

	if err := hc.AddRepo(ctx, "test", srv.URL); err != nil {
		t.Fatalf("add repo: %v", err)
	}
	vals := "replicaCount: 1"
	rel, err := hc.Install(ctx, gen.HelmInstallRequest{Ns: ns, Name: name, Chart: "test/radar", Values: &vals})
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if rel.Status != "deployed" || rel.Revision != 1 {
		t.Errorf("installed = %+v", rel)
	}

	waitFor(t, ch2, 60*time.Second, "release on the stream", func(m gen.WsMessage) bool {
		if m.Kind != gen.WsMessageKindHelmRelease {
			return false
		}
		var r gen.HelmRelease
		_ = json.Unmarshal(mustRaw(t, m), &r)
		return r.Name == name && r.Status == "deployed"
	})
	waitFor(t, ch2, 90*time.Second, "release-owned deployment", func(m gen.WsMessage) bool {
		if m.Kind != gen.WsMessageKindDeployment {
			return false
		}
		var d gen.Deployment
		_ = json.Unmarshal(mustRaw(t, m), &d)
		return d.Release != nil && *d.Release == name
	})

	if _, err := hc.Upgrade(ctx, ns, name, gen.HelmUpgradeRequest{Values: strPtr("replicaCount: 2")}); err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	hist, err := hc.History(ns, name)
	if err != nil || len(hist) != 2 {
		t.Fatalf("history = %+v, %v", hist, err)
	}
	if err := hc.Uninstall(ns, name); err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	waitFor(t, ch2, 60*time.Second, "release deleted on the stream", func(m gen.WsMessage) bool {
		return m.Kind == gen.WsMessageKindHelmRelease && m.Type == gen.WsMessageTypeDeleted
	})
}

func strPtr(s string) *string { return &s }
