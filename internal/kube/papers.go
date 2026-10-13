package kube

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/yaml"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

// Papers: an object's spec (what you asked for) and status (what the
// cluster reports), as two YAML documents, plus who has written to it.
func Papers(ctx context.Context, client kubernetes.Interface, kind, ns, name string) (gen.ObjectPapers, error) {
	var obj runtime.Object
	var err error
	get := metav1.GetOptions{}
	switch kind {
	case "Deployment":
		obj, err = client.AppsV1().Deployments(ns).Get(ctx, name, get)
	case "Pod":
		obj, err = client.CoreV1().Pods(ns).Get(ctx, name, get)
	case "Service":
		obj, err = client.CoreV1().Services(ns).Get(ctx, name, get)
	case "Ingress":
		obj, err = client.NetworkingV1().Ingresses(ns).Get(ctx, name, get)
	case "StatefulSet":
		obj, err = client.AppsV1().StatefulSets(ns).Get(ctx, name, get)
	case "DaemonSet":
		obj, err = client.AppsV1().DaemonSets(ns).Get(ctx, name, get)
	case "Job":
		obj, err = client.BatchV1().Jobs(ns).Get(ctx, name, get)
	case "ConfigMap":
		obj, err = client.CoreV1().ConfigMaps(ns).Get(ctx, name, get)
	case "Namespace":
		obj, err = client.CoreV1().Namespaces().Get(ctx, name, get)
	default:
		return gen.ObjectPapers{}, invalid("kind %q has no papers here", kind)
	}
	if err != nil {
		return gen.ObjectPapers{}, err
	}
	return papersOf(kind, ns, name, obj)
}

func papersOf(kind, ns, name string, obj runtime.Object) (gen.ObjectPapers, error) {
	raw, err := json.Marshal(obj)
	if err != nil {
		return gen.ObjectPapers{}, err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return gen.ObjectPapers{}, err
	}
	meta, _ := m["metadata"].(map[string]any)
	managers := ManagersOf(meta)
	keep := map[string]any{}
	for _, k := range []string{"labels", "annotations", "ownerReferences", "creationTimestamp", "uid", "resourceVersion", "generation"} {
		if v, ok := meta[k]; ok {
			keep[k] = v
		}
	}
	specKey := "spec"
	if kind == "ConfigMap" {
		specKey = "data"
	}
	spec := m[specKey]
	status := m["status"]
	out := gen.ObjectPapers{Kind: kind, Ns: ns, Name: name, Managers: managers}
	if out.Metadata, err = toYAML(keep); err != nil {
		return out, err
	}
	if spec != nil {
		if out.Spec, err = toYAML(spec); err != nil {
			return out, err
		}
	}
	if status != nil {
		if out.Status, err = toYAML(status); err != nil {
			return out, err
		}
	}
	return out, nil
}

func toYAML(v any) (string, error) {
	b, err := yaml.Marshal(v)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(b), "\n"), nil
}

// ManagersOf lists the distinct field managers in metadata.managedFields,
// oldest write first; the kubelet, scheduler and controllers each leave
// their name here, which is how the ledger knows who did what.
func ManagersOf(meta map[string]any) []string {
	entries, _ := meta["managedFields"].([]any)
	type stamp struct {
		name string
		time string
	}
	var stamps []stamp
	for _, e := range entries {
		em, _ := e.(map[string]any)
		name, _ := em["manager"].(string)
		if name == "" {
			continue
		}
		t, _ := em["time"].(string)
		stamps = append(stamps, stamp{name, t})
	}
	sort.SliceStable(stamps, func(i, j int) bool { return stamps[i].time < stamps[j].time })
	seen := map[string]bool{}
	out := []string{}
	for _, s := range stamps {
		if !seen[s.name] {
			seen[s.name] = true
			out = append(out, s.name)
		}
	}
	return out
}

// managersOfMeta is ManagersOf for a typed ObjectMeta.
func managersOfMeta(meta metav1.ObjectMeta) []string {
	if len(meta.ManagedFields) == 0 {
		return nil
	}
	entries := make([]any, 0, len(meta.ManagedFields))
	for _, f := range meta.ManagedFields {
		e := map[string]any{"manager": f.Manager}
		if f.Time != nil {
			e["time"] = f.Time.UTC().Format("2006-01-02T15:04:05Z")
		}
		entries = append(entries, e)
	}
	return ManagersOf(map[string]any{"managedFields": entries})
}

var _ = fmt.Sprintf
