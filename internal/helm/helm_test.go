package helm_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ericomanoff/harbor/internal/api/gen"
	"github.com/ericomanoff/harbor/internal/helm"
	"github.com/ericomanoff/harbor/internal/helm/helmtest"
)

func testClient(t *testing.T) (*helm.Client, string) {
	t.Helper()
	return helmtest.NewClient(t, helmtest.ChartDir(t))
}

func TestReposAndSearch(t *testing.T) {
	c, url := testClient(t)
	ctx := context.Background()

	repos, err := c.ListRepos()
	if err != nil || len(repos) != 0 {
		t.Fatalf("fresh client repos = %v, %v", repos, err)
	}
	if err := c.AddRepo(ctx, "bad name", url); err == nil {
		t.Error("name with a space should be rejected")
	}
	if err := c.AddRepo(ctx, "nowhere", "http://127.0.0.1:1/"); err == nil {
		t.Error("unreachable repo should fail at index download")
	}
	if err := c.AddRepo(ctx, "test", url); err != nil {
		t.Fatalf("add: %v", err)
	}
	repos, _ = c.ListRepos()
	if len(repos) != 1 || repos[0].Name != "test" || repos[0].Url != url {
		t.Fatalf("repos = %+v", repos)
	}

	charts, err := c.SearchCharts("rad")
	if err != nil || len(charts) != 1 {
		t.Fatalf("search = %+v, %v", charts, err)
	}
	if charts[0].Repo != "test" || charts[0].Name != "radar" || charts[0].Version != "0.1.0" || charts[0].AppVersion == nil || *charts[0].AppVersion != "1.27" {
		t.Errorf("chart = %+v", charts[0])
	}
	if all, _ := c.SearchCharts(""); len(all) != 1 {
		t.Errorf("empty query should list everything, got %d", len(all))
	}
	if none, _ := c.SearchCharts("zzz"); len(none) != 0 {
		t.Errorf("no match expected, got %d", len(none))
	}
	if err := c.UpdateRepos(ctx); err != nil {
		t.Errorf("update: %v", err)
	}

	vals, err := c.ChartValues("test/radar", "")
	if err != nil {
		t.Fatalf("values: %v", err)
	}
	if !strings.Contains(vals.Values, "replicaCount: 1") || vals.Version != "0.1.0" {
		t.Errorf("values = %+v", vals)
	}
	_, err = c.ChartValues("test/nope", "")
	var ve *helm.ValidationError
	if !errors.As(err, &ve) {
		t.Errorf("unknown chart should be a ValidationError, got %v", err)
	}
}

func TestReleaseLifecycle(t *testing.T) {
	c, url := testClient(t)
	ctx := context.Background()
	if err := c.AddRepo(ctx, "test", url); err != nil {
		t.Fatal(err)
	}

	if _, err := c.Install(ctx, gen.HelmInstallRequest{Ns: "", Name: "x", Chart: "test/radar"}); err == nil {
		t.Error("missing namespace should be rejected")
	}
	bad := "replicaCount: [unclosed"
	if _, err := c.Install(ctx, gen.HelmInstallRequest{Ns: "sandbox", Name: "x", Chart: "test/radar", Values: &bad}); err == nil {
		t.Error("broken values yaml should be rejected")
	}

	vals := "replicaCount: 2"
	rel, err := c.Install(ctx, gen.HelmInstallRequest{Ns: "sandbox", Name: "outpost", Chart: "test/radar", Values: &vals, MapPos: &gen.MapPos{X: 4, Y: 2}})
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if rel.Ns != "sandbox" || rel.Name != "outpost" || rel.Revision != 1 || rel.Status != "deployed" || rel.Chart == nil || *rel.Chart != "radar" {
		t.Errorf("installed = %+v", rel)
	}

	list, err := c.ListReleases()
	if err != nil || len(list) != 1 || list[0].Name != "outpost" {
		t.Fatalf("list = %+v, %v", list, err)
	}

	up, err := c.Upgrade(ctx, "sandbox", "outpost", gen.HelmUpgradeRequest{Chart: strPtr("test/radar"), Values: strPtr("replicaCount: 3")})
	if err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	if up.Revision != 2 || up.Status != "deployed" {
		t.Errorf("upgraded = %+v", up)
	}

	hist, err := c.History("sandbox", "outpost")
	if err != nil || len(hist) != 2 || hist[0].Revision != 1 || hist[0].Status != "superseded" || hist[1].Revision != 2 {
		t.Fatalf("history = %+v, %v", hist, err)
	}
	// No chart named: the stored chart is reused. Only a version named: the
	// chart is found again in the repository.
	if up, err := c.Upgrade(ctx, "sandbox", "outpost", gen.HelmUpgradeRequest{Values: strPtr("replicaCount: 4")}); err != nil || up.Revision != 3 {
		t.Fatalf("values-only upgrade = %+v, %v", up, err)
	}
	if up, err := c.Upgrade(ctx, "sandbox", "outpost", gen.HelmUpgradeRequest{Version: strPtr("0.1.0")}); err != nil || up.Revision != 4 {
		t.Fatalf("version-only upgrade = %+v, %v", up, err)
	}

	if err := c.Rollback("sandbox", "outpost", 0); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	hist, _ = c.History("sandbox", "outpost")
	if len(hist) != 5 || hist[4].Revision != 5 || !strings.Contains(hist[4].Description, "Rollback") {
		t.Errorf("after rollback history = %+v", hist)
	}

	if err := c.Uninstall("sandbox", "outpost"); err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	list, _ = c.ListReleases()
	if len(list) != 0 {
		t.Errorf("after uninstall list = %+v", list)
	}
	if err := c.Uninstall("sandbox", "outpost"); err == nil {
		t.Error("uninstalling twice should fail")
	}
}

func strPtr(s string) *string { return &s }
