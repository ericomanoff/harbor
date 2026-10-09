// Package campaign loads expeditions: vendor walkthroughs written as data
// (campaign.yaml), shipped inside the binary or dropped into
// ~/.config/harbor/campaigns/<id>/campaign.yaml.
package campaign

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"sigs.k8s.io/yaml"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

//go:embed builtin/*/campaign.yaml
var builtin embed.FS

// Step kinds, probes and goals are whitelists: a campaign cannot ask the
// harbor to do anything these do not cover.
var (
	stepKinds = map[string]bool{"instruct": true, "check": true, "form": true, "values": true, "helm-install": true, "helm-upgrade": true, "wait": true}
	forms     = map[string]bool{"shipyard": true, "lighthouse": true, "gate": true, "orders": true, "fleet": true, "refit": true}
	goalKinds = map[string]bool{"namespace-exists": true, "orders-exist": true, "deployment-ready": true, "release-deployed": true, "release-revision": true, "ingress-exists": true, "service-exists": true}
)

// Parse reads one campaign.yaml and validates it.
func Parse(data []byte) (gen.Campaign, error) {
	var c gen.Campaign
	if err := yaml.UnmarshalStrict(data, &c); err != nil {
		return c, err
	}
	return c, Validate(c)
}

// Validate checks ids, step kinds, forms, probes and goals against the whitelists.
func Validate(c gen.Campaign) error {
	if c.Id == "" || c.Title == "" {
		return fmt.Errorf("campaign needs an id and a title")
	}
	if len(c.Levels) == 0 {
		return fmt.Errorf("campaign %s has no levels", c.Id)
	}
	seen := map[string]bool{}
	for li, l := range c.Levels {
		if l.Id == "" || l.Title == "" {
			return fmt.Errorf("campaign %s: level %d needs an id and a title", c.Id, li+1)
		}
		if seen[l.Id] {
			return fmt.Errorf("campaign %s: level id %q repeats", c.Id, l.Id)
		}
		seen[l.Id] = true
		if len(l.Steps) == 0 {
			return fmt.Errorf("campaign %s: level %s has no steps", c.Id, l.Id)
		}
		for si, s := range l.Steps {
			where := fmt.Sprintf("campaign %s: level %s step %d", c.Id, l.Id, si+1)
			if !stepKinds[string(s.Kind)] {
				return fmt.Errorf("%s: unknown kind %q", where, s.Kind)
			}
			switch s.Kind {
			case "check":
				if s.Probe == nil || !KnownProbe(*s.Probe) {
					return fmt.Errorf("%s: check needs a whitelisted probe (have %v)", where, deref(s.Probe))
				}
			case "form":
				if s.Form == nil || !forms[*s.Form] {
					return fmt.Errorf("%s: form must be one of shipyard, lighthouse, gate, orders, fleet, refit", where)
				}
			case "values", "helm-install":
				if s.Chart == nil || s.Release == nil || s.Ns == nil {
					return fmt.Errorf("%s: %s needs chart, release and ns", where, s.Kind)
				}
			case "helm-upgrade":
				if s.Release == nil || s.Ns == nil {
					return fmt.Errorf("%s: helm-upgrade needs release and ns", where)
				}
			case "wait":
				if s.Goal == nil {
					return fmt.Errorf("%s: wait needs a goal", where)
				}
			}
			if s.Goal != nil && !goalKinds[string(s.Goal.Kind)] {
				return fmt.Errorf("%s: unknown goal %q", where, s.Goal.Kind)
			}
		}
	}
	return nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// Load returns the built-in campaigns plus any under userDir (which wins on
// id clashes), sorted by title. A broken user campaign is reported, not fatal.
func Load(userDir string) ([]gen.Campaign, []error) {
	byID := map[string]gen.Campaign{}
	var errs []error
	_ = fs.WalkDir(builtin, "builtin", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, "campaign.yaml") {
			return nil
		}
		data, err := builtin.ReadFile(path)
		if err != nil {
			return nil
		}
		c, err := Parse(data)
		if err != nil {
			errs = append(errs, fmt.Errorf("builtin %s: %w", path, err))
			return nil
		}
		t := true
		c.Builtin = &t
		byID[c.Id] = c
		return nil
	})
	if userDir != "" {
		entries, err := os.ReadDir(userDir)
		if err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					continue
				}
				p := filepath.Join(userDir, e.Name(), "campaign.yaml")
				data, err := os.ReadFile(p)
				if err != nil {
					continue
				}
				c, err := Parse(data)
				if err != nil {
					errs = append(errs, fmt.Errorf("%s: %w", p, err))
					continue
				}
				f := false
				c.Builtin = &f
				byID[c.Id] = c
			}
		}
	}
	out := make([]gen.Campaign, 0, len(byID))
	for _, c := range byID {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Title < out[j].Title })
	return out, errs
}

// DefaultUserDir is ~/.config/harbor/campaigns.
func DefaultUserDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "harbor", "campaigns")
}
