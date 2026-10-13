package kube

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/kubernetes"
	sigyaml "sigs.k8s.io/yaml"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

// FieldManager is the name server-side apply records for the harbor's writes.
const FieldManager = "harbor"

// applyKinds is the whitelist: apiVersion/kind → how to read the current
// object and how to apply. Anything else is refused.
type applier struct {
	get   func(ctx context.Context, c kubernetes.Interface, ns, name string) (any, error)
	apply func(ctx context.Context, c kubernetes.Interface, ns, name string, data []byte, opts metav1.PatchOptions) (any, error)
	namespaced bool
}

var applyKinds = map[string]applier{
	"apps/v1/Deployment": {namespaced: true,
		get:   func(ctx context.Context, c kubernetes.Interface, ns, n string) (any, error) { return c.AppsV1().Deployments(ns).Get(ctx, n, metav1.GetOptions{}) },
		apply: func(ctx context.Context, c kubernetes.Interface, ns, n string, d []byte, o metav1.PatchOptions) (any, error) { return c.AppsV1().Deployments(ns).Patch(ctx, n, types.ApplyPatchType, d, o) }},
	"apps/v1/StatefulSet": {namespaced: true,
		get:   func(ctx context.Context, c kubernetes.Interface, ns, n string) (any, error) { return c.AppsV1().StatefulSets(ns).Get(ctx, n, metav1.GetOptions{}) },
		apply: func(ctx context.Context, c kubernetes.Interface, ns, n string, d []byte, o metav1.PatchOptions) (any, error) { return c.AppsV1().StatefulSets(ns).Patch(ctx, n, types.ApplyPatchType, d, o) }},
	"batch/v1/Job": {namespaced: true,
		get:   func(ctx context.Context, c kubernetes.Interface, ns, n string) (any, error) { return c.BatchV1().Jobs(ns).Get(ctx, n, metav1.GetOptions{}) },
		apply: func(ctx context.Context, c kubernetes.Interface, ns, n string, d []byte, o metav1.PatchOptions) (any, error) { return c.BatchV1().Jobs(ns).Patch(ctx, n, types.ApplyPatchType, d, o) }},
	"v1/Service": {namespaced: true,
		get:   func(ctx context.Context, c kubernetes.Interface, ns, n string) (any, error) { return c.CoreV1().Services(ns).Get(ctx, n, metav1.GetOptions{}) },
		apply: func(ctx context.Context, c kubernetes.Interface, ns, n string, d []byte, o metav1.PatchOptions) (any, error) { return c.CoreV1().Services(ns).Patch(ctx, n, types.ApplyPatchType, d, o) }},
	"v1/ConfigMap": {namespaced: true,
		get:   func(ctx context.Context, c kubernetes.Interface, ns, n string) (any, error) { return c.CoreV1().ConfigMaps(ns).Get(ctx, n, metav1.GetOptions{}) },
		apply: func(ctx context.Context, c kubernetes.Interface, ns, n string, d []byte, o metav1.PatchOptions) (any, error) { return c.CoreV1().ConfigMaps(ns).Patch(ctx, n, types.ApplyPatchType, d, o) }},
	"v1/Secret": {namespaced: true,
		get:   func(ctx context.Context, c kubernetes.Interface, ns, n string) (any, error) { return c.CoreV1().Secrets(ns).Get(ctx, n, metav1.GetOptions{}) },
		apply: func(ctx context.Context, c kubernetes.Interface, ns, n string, d []byte, o metav1.PatchOptions) (any, error) { return c.CoreV1().Secrets(ns).Patch(ctx, n, types.ApplyPatchType, d, o) }},
	"v1/Namespace": {namespaced: false,
		get:   func(ctx context.Context, c kubernetes.Interface, _, n string) (any, error) { return c.CoreV1().Namespaces().Get(ctx, n, metav1.GetOptions{}) },
		apply: func(ctx context.Context, c kubernetes.Interface, _, n string, d []byte, o metav1.PatchOptions) (any, error) { return c.CoreV1().Namespaces().Patch(ctx, n, types.ApplyPatchType, d, o) }},
	"networking.k8s.io/v1/Ingress": {namespaced: true,
		get:   func(ctx context.Context, c kubernetes.Interface, ns, n string) (any, error) { return c.NetworkingV1().Ingresses(ns).Get(ctx, n, metav1.GetOptions{}) },
		apply: func(ctx context.Context, c kubernetes.Interface, ns, n string, d []byte, o metav1.PatchOptions) (any, error) { return c.NetworkingV1().Ingresses(ns).Patch(ctx, n, types.ApplyPatchType, d, o) }},
}

// Apply runs server-side apply for every document in the manifest. With
// dryRun nothing is written; either way each item says whether the object
// would be created, configured or left unchanged, with the spec diff.
func Apply(ctx context.Context, client kubernetes.Interface, req gen.ApplyRequest) (gen.ApplyResult, error) {
	docs, err := splitDocs(req.Manifest)
	if err != nil {
		return gen.ApplyResult{}, err
	}
	if len(docs) == 0 {
		return gen.ApplyResult{}, invalid("the manifest is empty")
	}
	dry := req.DryRun != nil && *req.DryRun
	// Validate every document first so a bad one later in the file does not
	// leave the earlier ones half applied.
	for _, doc := range docs {
		if _, _, err := applierFor(doc); err != nil {
			return gen.ApplyResult{}, err
		}
	}
	out := gen.ApplyResult{Results: []gen.ApplyItem{}}
	for _, doc := range docs {
		item, err := applyOne(ctx, client, doc, dry)
		if err != nil {
			return out, err
		}
		out.Results = append(out.Results, item)
	}
	return out, nil
}

func splitDocs(manifest string) ([]map[string]any, error) {
	dec := yaml.NewYAMLOrJSONDecoder(strings.NewReader(manifest), 4096)
	var docs []map[string]any
	for {
		var m map[string]any
		if err := dec.Decode(&m); err != nil {
			if err == io.EOF {
				return docs, nil
			}
			return nil, invalid("manifest: %v", err)
		}
		if len(m) > 0 {
			docs = append(docs, m)
		}
	}
}

// applierFor checks a document against the whitelist and returns its applier and identity.
func applierFor(doc map[string]any) (applier, gen.ApplyItem, error) {
	apiVersion, _ := doc["apiVersion"].(string)
	kind, _ := doc["kind"].(string)
	meta, _ := doc["metadata"].(map[string]any)
	name, _ := meta["name"].(string)
	ns, _ := meta["namespace"].(string)
	key := apiVersion + "/" + kind
	a, ok := applyKinds[key]
	if !ok {
		return a, gen.ApplyItem{}, invalid("%s is not something the harbor applies (allowed: Deployment, StatefulSet, Job, Service, ConfigMap, Secret, Namespace, Ingress)", key)
	}
	if name == "" {
		return a, gen.ApplyItem{}, invalid("%s needs metadata.name", kind)
	}
	if a.namespaced && ns == "" {
		return a, gen.ApplyItem{}, invalid("%s %s needs metadata.namespace", kind, name)
	}
	return a, gen.ApplyItem{Kind: kind, Ns: ns, Name: name}, nil
}

func applyOne(ctx context.Context, client kubernetes.Interface, doc map[string]any, dry bool) (gen.ApplyItem, error) {
	a, item, err := applierFor(doc)
	if err != nil {
		return item, err
	}
	kind, ns, name := item.Kind, item.Ns, item.Name
	before, err := a.get(ctx, client, ns, name)
	exists := err == nil
	if err != nil && !apierrors.IsNotFound(err) {
		return item, err
	}
	data, err := json.Marshal(doc)
	if err != nil {
		return item, err
	}
	force := true
	opts := metav1.PatchOptions{FieldManager: FieldManager, Force: &force}
	var diff string
	if dry {
		// A dry run compares the document to the current object locally: the
		// server would do the same merge, and this way a fake API (tests)
		// cannot write by accident.
		if exists {
			diff = specDiff(before, doc, kind)
		}
	} else {
		after, err := a.apply(ctx, client, ns, name, data, opts)
		if err != nil {
			return item, err
		}
		diff = specDiff(before, after, kind)
	}
	switch {
	case !exists:
		item.Action = gen.Created
	case diff == "":
		item.Action = gen.Unchanged
	default:
		item.Action = gen.Configured
	}
	if diff != "" {
		item.Diff = &diff
	}
	return item, nil
}

// specDiff compares the spec (data for ConfigMaps/Secrets, labels for
// Namespaces) of two objects line by line, kubectl-diff style.
func specDiff(before, after any, kind string) string {
	if before == nil {
		return ""
	}
	pick := func(o any) string {
		raw, _ := json.Marshal(o)
		var m map[string]any
		_ = json.Unmarshal(raw, &m)
		var v any
		switch kind {
		case "ConfigMap", "Secret":
			v = m["data"]
		case "Namespace":
			meta, _ := m["metadata"].(map[string]any)
			v = meta["labels"]
		default:
			v = m["spec"]
		}
		b, _ := sigyaml.Marshal(v)
		return string(b)
	}
	return lineDiff(pick(before), pick(after))
}

// lineDiff is a small LCS-free diff: lines only in one side are listed
// with - / +. Good enough for a spec that changes a few fields.
func lineDiff(a, b string) string {
	al := strings.Split(strings.TrimRight(a, "\n"), "\n")
	bl := strings.Split(strings.TrimRight(b, "\n"), "\n")
	inA := map[string]int{}
	for _, l := range al {
		inA[l]++
	}
	inB := map[string]int{}
	for _, l := range bl {
		inB[l]++
	}
	var buf bytes.Buffer
	for _, l := range al {
		if inB[l] == 0 {
			fmt.Fprintf(&buf, "- %s\n", l)
		}
	}
	for _, l := range bl {
		if inA[l] == 0 {
			fmt.Fprintf(&buf, "+ %s\n", l)
		}
	}
	return strings.TrimRight(buf.String(), "\n")
}

// PatchPodLabels sets and removes labels on a pod: the ship changes ensign.
func PatchPodLabels(ctx context.Context, client kubernetes.Interface, ns, name string, p gen.LabelPatch) error {
	patch, err := labelMergePatch(p, nil)
	if err != nil {
		return err
	}
	_, err = client.CoreV1().Pods(ns).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

// PatchDeploymentLabels changes the pod template labels of a Deployment.
// Selector labels cannot be removed (the selector is immutable and the
// template must keep matching it).
func PatchDeploymentLabels(ctx context.Context, client kubernetes.Interface, ns, name string, p gen.LabelPatch) error {
	d, err := client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return err
	}
	protected := map[string]bool{}
	if d.Spec.Selector != nil {
		for k := range d.Spec.Selector.MatchLabels {
			protected[k] = true
		}
	}
	patch, err := labelMergePatch(p, protected)
	if err != nil {
		return err
	}
	// The same merge patch, one level deeper.
	full, _ := json.Marshal(map[string]any{"spec": map[string]any{"template": json.RawMessage(patch)}})
	_, err = client.AppsV1().Deployments(ns).Patch(ctx, name, types.MergePatchType, full, metav1.PatchOptions{})
	return err
}

func labelMergePatch(p gen.LabelPatch, protected map[string]bool) ([]byte, error) {
	labels := map[string]any{}
	if p.Set != nil {
		for k, v := range *p.Set {
			if errs := validateLabel(k, v); errs != "" {
				return nil, invalid("label %s=%s: %s", k, v, errs)
			}
			if protected[k] && v != "" {
				// allowed only if unchanged in spirit: the selector must still match
				return nil, invalid("label %s is part of the selector and cannot change on the template", k)
			}
			labels[k] = v
		}
	}
	if p.Remove != nil {
		for _, k := range *p.Remove {
			if protected[k] {
				return nil, invalid("label %s is part of the selector and cannot be removed from the template", k)
			}
			labels[k] = nil
		}
	}
	if len(labels) == 0 {
		return nil, invalid("nothing to change")
	}
	return json.Marshal(map[string]any{"metadata": map[string]any{"labels": labels}})
}
