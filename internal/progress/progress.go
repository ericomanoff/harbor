// Package progress keeps Harbor Academy results in a small JSON file under
// the user's config directory, so stars survive browsers and reinstalls.
package progress

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

// Store reads and writes one progress file.
type Store struct {
	path string
	mu   sync.Mutex
}

// DefaultPath is ~/.config/harbor/progress.json (per os.UserConfigDir).
func DefaultPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "harbor", "progress.json"), nil
}

func New(path string) *Store { return &Store{path: path} }

// Load returns the file's contents, or an empty progress when it is missing.
func (s *Store) Load() (gen.Progress, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

func (s *Store) load() (gen.Progress, error) {
	p := gen.Progress{Levels: map[string]gen.LevelProgress{}}
	b, err := os.ReadFile(s.path)
	if errors.Is(err, fs.ErrNotExist) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if err := json.Unmarshal(b, &p); err != nil {
		return p, fmt.Errorf("progress file %s: %w", s.path, err)
	}
	if p.Levels == nil {
		p.Levels = map[string]gen.LevelProgress{}
	}
	return p, nil
}

// Record merges a level result, keeping the best stars and time and the
// fewest hints, and returns the whole progress.
func (s *Store) Record(level string, in gen.LevelProgress) (gen.Progress, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if in.Stars < 0 || in.Stars > 3 {
		return gen.Progress{}, fmt.Errorf("stars must be 0-3")
	}
	p, err := s.load()
	if err != nil {
		return p, err
	}
	cur, had := p.Levels[level]
	out := in
	if had {
		if cur.Stars > out.Stars {
			out.Stars = cur.Stars
		}
		if cur.BestSeconds != nil && (out.BestSeconds == nil || *cur.BestSeconds < *out.BestSeconds) {
			out.BestSeconds = cur.BestSeconds
		}
		if cur.HintsUsed != nil && (out.HintsUsed == nil || *cur.HintsUsed < *out.HintsUsed) {
			out.HintsUsed = cur.HintsUsed
		}
		if cur.CompletedAt != nil && out.CompletedAt == nil {
			out.CompletedAt = cur.CompletedAt
		}
	}
	if out.CompletedAt == nil {
		now := time.Now().UTC()
		out.CompletedAt = &now
	}
	p.Levels[level] = out
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return p, err
	}
	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return p, err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return p, err
	}
	return p, os.Rename(tmp, s.path)
}
