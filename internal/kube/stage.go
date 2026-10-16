package kube

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/kubernetes"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

// Academy incidents are staged on a real cluster only inside namespaces
// carrying this label, and only through the whitelist below.
const (
	AcademyLabel = "harbor.dev/academy"
	StagedLabel  = "harbor.dev/staged"
	defaultShip  = "nginx:1.27-alpine"
)

// Stage performs one whitelisted incident. Every incident but cleanup
// refuses namespaces that do not carry the academy label.
func Stage(ctx context.Context, client kubernetes.Interface, incident string, req gen.StageRequest) (gen.StageResult, error) {
	ns := derefStr(req.Ns)
	name := derefStr(req.Name)
	out := gen.StageResult{Incident: incident}
	switch incident {
	case "cleanup":
		n, err := CleanupAcademy(ctx, client)
		if err != nil {
			return out, err
		}
		out.Message = fmt.Sprintf("%d academy fleet(s) scuttled", n)
		return out, nil
	case "found":
		if errs := validation.IsDNS1123Label(ns); len(errs) > 0 {
			return out, invalid("namespace %q: %s", ns, strings.Join(errs, "; "))
		}
		if !strings.HasPrefix(ns, "harbor-academy") {
			return out, invalid("academy fleets are named harbor-academy*")
		}
		_, err := client.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns, Labels: map[string]string{ManagedByLabel: managedByValue, AcademyLabel: "true"}}}, metav1.CreateOptions{})
		if err != nil && !apierrors.IsAlreadyExists(err) {
			return out, err
		}
		out.Message = "fleet " + ns + " founded for the academy"
		out.Name = optString(ns)
		return out, nil
	}
	if err := academyNamespace(ctx, client, ns); err != nil {
		return out, err
	}
	switch incident {
	case "lone-ship":
		if errs := validation.IsDNS1123Label(name); len(errs) > 0 {
			return out, invalid("name %q: %s", name, strings.Join(errs, "; "))
		}
		image := derefStr(req.Image)
		if image == "" {
			image = defaultShip
		}
		pod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: map[string]string{"app": name, ManagedByLabel: managedByValue, StagedLabel: "true"}},
			Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: name, Image: image, Ports: []corev1.ContainerPort{{ContainerPort: 80, Name: "http"}}}}},
		}
		if _, err := client.CoreV1().Pods(ns).Create(ctx, pod, metav1.CreateOptions{}); err != nil {
			return out, err
		}
		out.Message = "lone ship " + name + " sent out"
		out.Name = optString(name)
	case "sink-pod":
		if err := client.CoreV1().Pods(ns).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
			return out, err
		}
		out.Message = "ship " + name + " struck the reef"
		out.Name = optString(name)
	case "bad-refit":
		d, err := client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return out, err
		}
		if len(d.Spec.Template.Spec.Containers) == 0 {
			return out, invalid("deployment has no containers")
		}
		c := d.Spec.Template.Spec.Containers[0]
		repo := c.Image
		if i := strings.LastIndex(repo, ":"); i > strings.LastIndex(repo, "/") {
			repo = repo[:i]
		}
		bad := fmt.Sprintf("%s:broken-%d", repo, time.Now().Unix())
		patch, _ := json.Marshal(map[string]any{"spec": map[string]any{"template": map[string]any{"spec": map[string]any{"containers": []map[string]any{{"name": c.Name, "image": bad}}}}}})
		if _, err := client.AppsV1().Deployments(ns).Patch(ctx, name, types.StrategicMergePatchType, patch, metav1.PatchOptions{}); err != nil {
			return out, err
		}
		out.Message = "shipyard " + name + " refitting to a hull that does not exist: " + bad
		out.Name = optString(bad)
	case "drain":
		// Cordon the node and evict the academy fleet's pods on it; other
		// namespaces are never touched, so a shared cluster stays whole.
		node := derefStr(req.Node)
		if node == "" {
			return out, invalid("drain needs node")
		}
		if _, err := client.CoreV1().Nodes().Patch(ctx, node, types.MergePatchType, []byte(`{"spec":{"unschedulable":true}}`), metav1.PatchOptions{}); err != nil {
			return out, err
		}
		pods, err := client.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{FieldSelector: "spec.nodeName=" + node})
		if err != nil {
			return out, err
		}
		n := 0
		for i := range pods.Items {
			if err := client.CoreV1().Pods(ns).Delete(ctx, pods.Items[i].Name, metav1.DeleteOptions{}); err == nil {
				n++
			}
		}
		out.Message = fmt.Sprintf("island %s cordoned; %d ship(s) of %s evicted", node, n, ns)
		out.Name = optString(node)
	case "uncordon":
		node := derefStr(req.Node)
		if node == "" {
			return out, invalid("uncordon needs node")
		}
		if _, err := client.CoreV1().Nodes().Patch(ctx, node, types.MergePatchType, []byte(`{"spec":{"unschedulable":false}}`), metav1.PatchOptions{}); err != nil {
			return out, err
		}
		out.Message = "island " + node + " open again"
		out.Name = optString(node)
	case "quota":
		// The harbor authority: a ResourceQuota and a LimitRange on the academy fleet.
		q := &corev1.ResourceQuota{ObjectMeta: metav1.ObjectMeta{Name: "harbor-authority", Namespace: ns, Labels: map[string]string{ManagedByLabel: managedByValue, StagedLabel: "true"}},
			Spec: corev1.ResourceQuotaSpec{Hard: corev1.ResourceList{corev1.ResourcePods: resource.MustParse("5"), corev1.ResourceRequestsCPU: resource.MustParse("2"), corev1.ResourceRequestsMemory: resource.MustParse("2Gi")}}}
		if _, err := client.CoreV1().ResourceQuotas(ns).Create(ctx, q, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
			return out, err
		}
		lr := &corev1.LimitRange{ObjectMeta: metav1.ObjectMeta{Name: "harbor-authority", Namespace: ns, Labels: map[string]string{ManagedByLabel: managedByValue, StagedLabel: "true"}},
			Spec: corev1.LimitRangeSpec{Limits: []corev1.LimitRangeItem{{Type: corev1.LimitTypeContainer,
				DefaultRequest: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("100m"), corev1.ResourceMemory: resource.MustParse("64Mi")},
				Default:        corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("500m"), corev1.ResourceMemory: resource.MustParse("256Mi")}}}}}
		if _, err := client.CoreV1().LimitRanges(ns).Create(ctx, lr, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
			return out, err
		}
		out.Message = "harbor authority posted on " + ns + ": 5 pods, 2 CPU, 2Gi requests; defaults 100m/64Mi"
		out.Name = optString("harbor-authority")
	default:
		return out, invalid("unknown incident %q", incident)
	}
	return out, nil
}

func academyNamespace(ctx context.Context, client kubernetes.Interface, ns string) error {
	if ns == "" {
		return invalid("ns is required")
	}
	n, err := client.CoreV1().Namespaces().Get(ctx, ns, metav1.GetOptions{})
	if err != nil {
		return err
	}
	if n.Labels[AcademyLabel] != "true" {
		return invalid("namespace %q is not an academy fleet; incidents are staged only in fleets founded by the academy", ns)
	}
	return nil
}

// CleanupAcademy deletes every namespace the academy founded.
func CleanupAcademy(ctx context.Context, client kubernetes.Interface) (int, error) {
	list, err := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{LabelSelector: AcademyLabel + "=true"})
	if err != nil {
		return 0, err
	}
	n := 0
	for i := range list.Items {
		if list.Items[i].Status.Phase == corev1.NamespaceTerminating {
			continue
		}
		if err := client.CoreV1().Namespaces().Delete(ctx, list.Items[i].Name, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
			return n, err
		}
		n++
	}
	return n, nil
}
