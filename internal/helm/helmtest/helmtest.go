// Package helmtest builds a helm.Client that serves a chart directory from a
// local repository and runs Helm against an in-memory store with a printing
// kube client. Shared by the helm and api test suites.
package helmtest

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/cli"
	kubefake "helm.sh/helm/v3/pkg/kube/fake"
	"helm.sh/helm/v3/pkg/registry"
	"helm.sh/helm/v3/pkg/repo"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"

	"github.com/ericomanoff/harbor/internal/helm"
)

// NewClient packages chartDir into a served repository and returns a client
// with empty repository config plus the repository's URL.
func NewClient(t *testing.T, chartDir string) (*helm.Client, string) {
	t.Helper()
	dir := t.TempDir()

	ch, err := loader.Load(chartDir)
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
	t.Cleanup(srv.Close)
	idx, err := repo.IndexDirectory(repoDir, srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if err := idx.WriteFile(filepath.Join(repoDir, "index.yaml"), 0o644); err != nil {
		t.Fatal(err)
	}

	settings := cli.New()
	settings.RepositoryConfig = filepath.Join(dir, "repositories.yaml")
	settings.RepositoryCache = filepath.Join(dir, "cache")

	mem := driver.NewMemory()
	mem.SetNamespace("")
	store := storage.Init(mem)
	reg, err := registry.NewClient()
	if err != nil {
		t.Fatal(err)
	}
	config := func(string) (*action.Configuration, error) {
		return &action.Configuration{
			Releases:       store,
			KubeClient:     &kubefake.PrintingKubeClient{Out: io.Discard},
			Capabilities:   chartutil.DefaultCapabilities,
			RegistryClient: reg,
			Log:            func(string, ...any) {},
		}, nil
	}
	return helm.NewWithConfig(settings, config), srv.URL
}

// ChartDir is the test chart shipped with the helm package, relative to the
// repository root.
func ChartDir(t *testing.T) string {
	t.Helper()
	for _, p := range []string{"testdata/charts/radar", "../helm/testdata/charts/radar", "../../internal/helm/testdata/charts/radar"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	t.Fatal("test chart not found")
	return ""
}
