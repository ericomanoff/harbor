package progress

import (
	"path/filepath"
	"testing"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

func f64(v float64) *float64 { return &v }
func i(v int) *int           { return &v }

func TestRecordKeepsTheBest(t *testing.T) {
	s := New(filepath.Join(t.TempDir(), "nested", "progress.json"))
	p, err := s.Load()
	if err != nil || len(p.Levels) != 0 {
		t.Fatalf("fresh load = %+v, %v", p, err)
	}
	if _, err := s.Record("academy/1", gen.LevelProgress{Stars: 2, BestSeconds: f64(90), HintsUsed: i(1)}); err != nil {
		t.Fatal(err)
	}
	p, err = s.Record("academy/1", gen.LevelProgress{Stars: 1, BestSeconds: f64(120), HintsUsed: i(3)})
	if err != nil {
		t.Fatal(err)
	}
	got := p.Levels["academy/1"]
	if got.Stars != 2 || *got.BestSeconds != 90 || *got.HintsUsed != 1 || got.CompletedAt == nil {
		t.Errorf("merged = %+v", got)
	}
	p, _ = s.Record("academy/1", gen.LevelProgress{Stars: 3, BestSeconds: f64(60)})
	if got := p.Levels["academy/1"]; got.Stars != 3 || *got.BestSeconds != 60 || *got.HintsUsed != 1 {
		t.Errorf("improved = %+v", got)
	}
	if _, err := s.Record("academy/2", gen.LevelProgress{Stars: 9}); err == nil {
		t.Error("stars out of range should fail")
	}
	again, err := New(s.path).Load()
	if err != nil || again.Levels["academy/1"].Stars != 3 {
		t.Errorf("reload = %+v, %v", again, err)
	}
}
