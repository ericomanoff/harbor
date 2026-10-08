package assets

import (
	"strings"
	"testing"
)

func TestPlaceholderExplainsTheFix(t *testing.T) {
	for _, want := range []string{"make web", "make dev", "Harbor", "No charts aboard"} {
		if !strings.Contains(placeholder, want) {
			t.Errorf("placeholder page lacks %q", want)
		}
	}
	if strings.Contains(placeholder, "#39ff14") {
		t.Error("placeholder page still uses the old radar green")
	}
}
