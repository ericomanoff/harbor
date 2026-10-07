// Package helm wraps the Helm Go SDK: repositories are the tech tree,
// charts are build options, releases are base expansions. Everything runs
// in-process; no helm binary is needed.
package helm

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/repo"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"sigs.k8s.io/yaml"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

// ConfigFunc builds an action.Configuration scoped to a namespace ("" for
// all). Production uses the kubeconfig context; tests inject a memory store.
type ConfigFunc func(namespace string) (*action.Configuration, error)

// Client is one cluster's Helm handle. Repository config and index cache
// follow Helm's own paths ($HELM_REPOSITORY_CONFIG etc.), so repositories
// added with the helm CLI appear here and vice versa.
type Client struct {
	settings *cli.EnvSettings
	config   ConfigFunc
}

// New returns a client for the named kubeconfig context.
func New(contextName string) *Client {
	settings := cli.New()
	return &Client{settings: settings, config: kubeConfig(contextName)}
}

// NewWithConfig lets tests supply the storage and kube client.
func NewWithConfig(settings *cli.EnvSettings, config ConfigFunc) *Client {
	return &Client{settings: settings, config: config}
}

func kubeConfig(contextName string) ConfigFunc {
	return func(namespace string) (*action.Configuration, error) {
		flags := genericclioptions.NewConfigFlags(false)
		flags.Context = &contextName
		if namespace != "" {
			flags.Namespace = &namespace
		}
		cfg := new(action.Configuration)
		if err := cfg.Init(flags, namespace, "secret", func(format string, v ...any) { log.Printf("helm: "+format, v...) }); err != nil {
			return nil, err
		}
		return cfg, nil
	}
}

// ---- repositories ---------------------------------------------------------

func (c *Client) repoFile() (*repo.File, error) {
	f, err := repo.LoadFile(c.settings.RepositoryConfig)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	if f == nil {
		f = repo.NewFile()
	}
	return f, nil
}

// ListRepos returns the configured chart repositories sorted by name.
func (c *Client) ListRepos() ([]gen.HelmRepo, error) {
	f, err := c.repoFile()
	if err != nil {
		return nil, err
	}
	out := make([]gen.HelmRepo, 0, len(f.Repositories))
	for _, r := range f.Repositories {
		out = append(out, gen.HelmRepo{Name: r.Name, Url: r.URL})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// AddRepo registers a repository and downloads its index.
func (c *Client) AddRepo(ctx context.Context, name, url string) error {
	name = strings.TrimSpace(name)
	url = strings.TrimSpace(url)
	if name == "" || url == "" || strings.ContainsAny(name, "/ ") {
		return &ValidationError{"repository needs a simple name and a URL"}
	}
	f, err := c.repoFile()
	if err != nil {
		return err
	}
	entry := &repo.Entry{Name: name, URL: url}
	if err := c.downloadIndex(ctx, entry); err != nil {
		return fmt.Errorf("fetch index for %s: %w", url, err)
	}
	f.Update(entry)
	if err := os.MkdirAll(filepath.Dir(c.settings.RepositoryConfig), 0o755); err != nil {
		return err
	}
	return f.WriteFile(c.settings.RepositoryConfig, 0o644)
}

// UpdateRepos refreshes every repository index.
func (c *Client) UpdateRepos(ctx context.Context) error {
	f, err := c.repoFile()
	if err != nil {
		return err
	}
	for _, e := range f.Repositories {
		if err := c.downloadIndex(ctx, e); err != nil {
			return fmt.Errorf("update %s: %w", e.Name, err)
		}
	}
	return nil
}

func (c *Client) downloadIndex(_ context.Context, e *repo.Entry) error {
	r, err := repo.NewChartRepository(e, getter.All(c.settings))
	if err != nil {
		return err
	}
	r.CachePath = c.settings.RepositoryCache
	_, err = r.DownloadIndexFile()
	return err
}

// SearchCharts scans the cached indexes for charts whose name or description
// contains q (case-insensitive). Only the latest version of each chart is
// returned. An empty query lists everything.
func (c *Client) SearchCharts(q string) ([]gen.HelmChart, error) {
	f, err := c.repoFile()
	if err != nil {
		return nil, err
	}
	q = strings.ToLower(strings.TrimSpace(q))
	out := []gen.HelmChart{}
	for _, e := range f.Repositories {
		idx, err := repo.LoadIndexFile(filepath.Join(c.settings.RepositoryCache, fmt.Sprintf("%s-index.yaml", e.Name)))
		if err != nil {
			continue // not fetched yet; UpdateRepos fixes it
		}
		idx.SortEntries()
		for name, versions := range idx.Entries {
			if len(versions) == 0 {
				continue
			}
			v := versions[0]
			if q != "" && !strings.Contains(strings.ToLower(name), q) && !strings.Contains(strings.ToLower(v.Description), q) {
				continue
			}
			ch := gen.HelmChart{Repo: e.Name, Name: name, Version: v.Version, Description: v.Description}
			if v.AppVersion != "" {
				ch.AppVersion = &v.AppVersion
			}
			out = append(out, ch)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name || (out[i].Name == out[j].Name && out[i].Repo < out[j].Repo)
	})
	return out, nil
}

// loadChart resolves "repo/name" (or a local path) at a version and loads it.
func (c *Client) loadChart(ref, version string) (*chart.Chart, error) {
	opts := action.ChartPathOptions{Version: version}
	path, err := opts.LocateChart(ref, c.settings)
	if err != nil {
		return nil, &ValidationError{fmt.Sprintf("chart %q: %v", ref, err)}
	}
	return loader.Load(path)
}

// ChartValues returns a chart's default values.yaml.
func (c *Client) ChartValues(ref, version string) (gen.HelmValues, error) {
	ch, err := c.loadChart(ref, version)
	if err != nil {
		return gen.HelmValues{}, err
	}
	for _, f := range ch.Raw {
		if f.Name == chartutil.ValuesfileName {
			return gen.HelmValues{Chart: ref, Version: ch.Metadata.Version, Values: string(f.Data)}, nil
		}
	}
	b, err := yaml.Marshal(ch.Values)
	if err != nil {
		return gen.HelmValues{}, err
	}
	return gen.HelmValues{Chart: ref, Version: ch.Metadata.Version, Values: string(b)}, nil
}

// ---- releases ---------------------------------------------------------------

func parseValues(text string) (map[string]any, error) {
	if strings.TrimSpace(text) == "" {
		return map[string]any{}, nil
	}
	v, err := chartutil.ReadValues([]byte(text))
	if err != nil {
		return nil, &ValidationError{"values: " + err.Error()}
	}
	return v, nil
}

// ListReleases lists releases in every namespace, newest revision only.
func (c *Client) ListReleases() ([]gen.HelmRelease, error) {
	cfg, err := c.config("")
	if err != nil {
		return nil, err
	}
	l := action.NewList(cfg)
	l.AllNamespaces = true
	l.All = true
	l.SetStateMask()
	rels, err := l.Run()
	if err != nil {
		return nil, err
	}
	out := make([]gen.HelmRelease, 0, len(rels))
	for _, r := range rels {
		out = append(out, ConvertRelease(r))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Ns < out[j].Ns || (out[i].Ns == out[j].Ns && out[i].Name < out[j].Name)
	})
	return out, nil
}

// Install installs a chart as a new release.
func (c *Client) Install(ctx context.Context, req gen.HelmInstallRequest) (gen.HelmRelease, error) {
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Ns) == "" || strings.TrimSpace(req.Chart) == "" {
		return gen.HelmRelease{}, &ValidationError{"ns, name and chart are required"}
	}
	ch, err := c.loadChart(req.Chart, deref(req.Version))
	if err != nil {
		return gen.HelmRelease{}, err
	}
	vals, err := parseValues(deref(req.Values))
	if err != nil {
		return gen.HelmRelease{}, err
	}
	cfg, err := c.config(req.Ns)
	if err != nil {
		return gen.HelmRelease{}, err
	}
	inst := action.NewInstall(cfg)
	inst.ReleaseName = req.Name
	inst.Namespace = req.Ns
	inst.CreateNamespace = true
	inst.Timeout = 5 * time.Minute
	if req.MapPos != nil {
		inst.Labels = map[string]string{"harbor.dev/map-pos": fmt.Sprintf("%d_%d", req.MapPos.X, req.MapPos.Y)}
	}
	rel, err := inst.RunWithContext(ctx, ch, vals)
	if err != nil {
		return gen.HelmRelease{}, err
	}
	return ConvertRelease(rel), nil
}

// Upgrade moves a release to a new chart version and/or values.
func (c *Client) Upgrade(ctx context.Context, ns, name string, req gen.HelmUpgradeRequest) (gen.HelmRelease, error) {
	cfg, err := c.config(ns)
	if err != nil {
		return gen.HelmRelease{}, err
	}
	// Which chart to upgrade to:
	//   chart given            -> locate it (optionally at a version);
	//   only a version given   -> same chart name from whichever repo has it;
	//   neither                -> reuse the chart stored in the release.
	var ch *chart.Chart
	switch {
	case deref(req.Chart) != "":
		ch, err = c.loadChart(deref(req.Chart), deref(req.Version))
	default:
		cur, gerr := action.NewGet(cfg).Run(name)
		if gerr != nil {
			return gen.HelmRelease{}, gerr
		}
		if deref(req.Version) == "" || cur.Chart == nil {
			ch, err = cur.Chart, nil
			if ch == nil {
				err = &ValidationError{"release has no stored chart; name one"}
			}
		} else {
			ref := cur.Chart.Metadata.Name
			if repoName := c.repoFor(ref); repoName != "" {
				ref = repoName + "/" + ref
			}
			ch, err = c.loadChart(ref, deref(req.Version))
		}
	}
	if err != nil {
		return gen.HelmRelease{}, err
	}
	vals, err := parseValues(deref(req.Values))
	if err != nil {
		return gen.HelmRelease{}, err
	}
	up := action.NewUpgrade(cfg)
	up.Namespace = ns
	up.Timeout = 5 * time.Minute
	rel, err := up.RunWithContext(ctx, name, ch, vals)
	if err != nil {
		return gen.HelmRelease{}, err
	}
	return ConvertRelease(rel), nil
}

// repoFor finds a repository whose cached index offers the chart. "" if none.
func (c *Client) repoFor(chartName string) string {
	f, err := c.repoFile()
	if err != nil {
		return ""
	}
	for _, e := range f.Repositories {
		idx, err := repo.LoadIndexFile(filepath.Join(c.settings.RepositoryCache, fmt.Sprintf("%s-index.yaml", e.Name)))
		if err != nil {
			continue
		}
		if _, ok := idx.Entries[chartName]; ok {
			return e.Name
		}
	}
	return ""
}

// Uninstall removes a release and its resources.
func (c *Client) Uninstall(ns, name string) error {
	cfg, err := c.config(ns)
	if err != nil {
		return err
	}
	u := action.NewUninstall(cfg)
	u.Timeout = 5 * time.Minute
	_, err = u.Run(name)
	return err
}

// History lists a release's revisions, oldest first.
func (c *Client) History(ns, name string) ([]gen.HelmRevision, error) {
	cfg, err := c.config(ns)
	if err != nil {
		return nil, err
	}
	rels, err := action.NewHistory(cfg).Run(name)
	if err != nil {
		return nil, err
	}
	sort.Slice(rels, func(i, j int) bool { return rels[i].Version < rels[j].Version })
	out := make([]gen.HelmRevision, 0, len(rels))
	for _, r := range rels {
		out = append(out, gen.HelmRevision{
			Revision:    r.Version,
			Status:      r.Info.Status.String(),
			Chart:       chartLabel(r),
			Updated:     r.Info.LastDeployed.Time,
			Description: r.Info.Description,
		})
	}
	return out, nil
}

// Rollback returns a release to a revision; 0 means the previous one.
func (c *Client) Rollback(ns, name string, revision int) error {
	cfg, err := c.config(ns)
	if err != nil {
		return err
	}
	rb := action.NewRollback(cfg)
	rb.Version = revision
	rb.Timeout = 5 * time.Minute
	return rb.Run(name)
}

func chartLabel(r *release.Release) string {
	if r.Chart == nil || r.Chart.Metadata == nil {
		return ""
	}
	return r.Chart.Metadata.Name + "-" + r.Chart.Metadata.Version
}

// ConvertRelease summarises a release for the wire.
func ConvertRelease(r *release.Release) gen.HelmRelease {
	out := gen.HelmRelease{Ns: r.Namespace, Name: r.Name, Revision: r.Version, Status: r.Info.Status.String()}
	if r.Chart != nil && r.Chart.Metadata != nil {
		name, ver, app := r.Chart.Metadata.Name, r.Chart.Metadata.Version, r.Chart.Metadata.AppVersion
		out.Chart = &name
		out.ChartVersion = &ver
		if app != "" {
			out.AppVersion = &app
		}
	}
	if !r.Info.LastDeployed.IsZero() {
		t := r.Info.LastDeployed.Time
		out.Updated = &t
	}
	if r.Info.Notes != "" {
		n := r.Info.Notes
		out.Notes = &n
	}
	return out
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ValidationError is a user mistake (400), as opposed to a Helm or cluster failure.
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }
