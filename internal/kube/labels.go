package kube

import (
	"strings"

	"k8s.io/apimachinery/pkg/util/validation"
)

// validateLabel checks a label key and value the way the API server would.
func validateLabel(k, v string) string {
	var errs []string
	errs = append(errs, validation.IsQualifiedName(k)...)
	errs = append(errs, validation.IsValidLabelValue(v)...)
	return strings.Join(errs, "; ")
}
