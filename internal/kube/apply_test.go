package kube

import (
	"context"
	"errors"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

const courierManifest = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: courier
  namespace: harbor
spec:
  replicas: %d
  selector:
    matchLabels:
      app: courier
  template:
    metadata:
      labels:
        app: courier
    spec:
      containers:
        - name: courier
          image: nginx:1.27-alpine
`

func TestApplyIsIdempotentAndDiffs(t *testing.T) {
	ctx := context.Background()
	client := fake.NewClientset()
	m3 := strings.Replace(courierManifest, "%d", "3", 1)
	dry := true
	res, err := Apply(ctx, client, gen.ApplyRequest{Manifest: m3, DryRun: &dry})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Results) != 1 || res.Results[0].Action != gen.Created {
		t.Fatalf("dry create: %+v", res)
	}
	if _, err := client.AppsV1().Deployments("harbor").Get(ctx, "courier", metav1.GetOptions{}); err == nil {
		t.Error("dry run must not create")
	}
	res, err = Apply(ctx, client, gen.ApplyRequest{Manifest: m3})
	if err != nil || res.Results[0].Action != gen.Created {
		t.Fatalf("create: %+v %v", res, err)
	}
	d, err := client.AppsV1().Deployments("harbor").Get(ctx, "courier", metav1.GetOptions{})
	if err != nil || *d.Spec.Replicas != 3 {
		t.Fatalf("after apply: %+v %v", d, err)
	}
	res, err = Apply(ctx, client, gen.ApplyRequest{Manifest: m3})
	if err != nil || res.Results[0].Action != gen.Unchanged || res.Results[0].Diff != nil {
		t.Errorf("second apply should be unchanged: %+v %v", res.Results[0], err)
	}
	m4 := strings.Replace(courierManifest, "%d", "4", 1)
	res, err = Apply(ctx, client, gen.ApplyRequest{Manifest: m4, DryRun: &dry})
	if err != nil || res.Results[0].Action != gen.Configured || res.Results[0].Diff == nil || !strings.Contains(*res.Results[0].Diff, "+ replicas: 4") || !strings.Contains(*res.Results[0].Diff, "- replicas: 3") {
		t.Errorf("dry configure: %+v %v", res.Results[0], err)
	}
	d, _ = client.AppsV1().Deployments("harbor").Get(ctx, "courier", metav1.GetOptions{})
	if *d.Spec.Replicas != 3 {
		t.Error("dry run changed replicas")
	}
	// Two documents, one unknown kind: refused as a whole before anything is written.
	var ve *ValidationError
	if _, err := Apply(ctx, client, gen.ApplyRequest{Manifest: m4 + "---\napiVersion: v1\nkind: Pod\nmetadata: {name: x, namespace: harbor}\n"}); !errors.As(err, &ve) {
		t.Errorf("unknown kind: err = %v, want ValidationError", err)
	}
	if _, err := Apply(ctx, client, gen.ApplyRequest{Manifest: "   \n"}); !errors.As(err, &ve) {
		t.Errorf("empty: err = %v", err)
	}
	if _, err := Apply(ctx, client, gen.ApplyRequest{Manifest: "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: cm}\n"}); !errors.As(err, &ve) {
		t.Errorf("missing namespace: err = %v", err)
	}
	// Papers of the applied Deployment carry our field manager.
	p, err := Papers(ctx, client, "Deployment", "harbor", "courier")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(p.Spec, "replicas: 3") {
		t.Errorf("papers spec: %s", p.Spec)
	}
	if len(p.Managers) == 0 || p.Managers[len(p.Managers)-1] != FieldManager {
		t.Errorf("managers: %v", p.Managers)
	}
}

func TestPapersKindsAndLabels(t *testing.T) {
	ctx := context.Background()
	client := fake.NewClientset(
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "p", Namespace: "harbor", Labels: map[string]string{"app": "courier"}}, Status: corev1.PodStatus{Phase: corev1.PodRunning, PodIP: "10.1.2.3"}},
		&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "cm", Namespace: "harbor"}, Data: map[string]string{"PORT": "80"}},
	)
	p, err := Papers(ctx, client, "Pod", "harbor", "p")
	if err != nil || !strings.Contains(p.Status, "podIP: 10.1.2.3") || !strings.Contains(p.Metadata, "app: courier") {
		t.Errorf("pod papers: %+v %v", p, err)
	}
	cm, err := Papers(ctx, client, "ConfigMap", "harbor", "cm")
	if err != nil || !strings.Contains(cm.Spec, "PORT") {
		t.Errorf("configmap papers: %+v %v", cm, err)
	}
	var ve *ValidationError
	if _, err := Papers(ctx, client, "Secret", "harbor", "x"); !errors.As(err, &ve) {
		t.Errorf("secret papers must be refused: %v", err)
	}
	if err := PatchPodLabels(ctx, client, "harbor", "p", gen.LabelPatch{Set: &map[string]string{"track": "canary"}, Remove: &[]string{"app"}}); err != nil {
		t.Fatal(err)
	}
	got, _ := client.CoreV1().Pods("harbor").Get(ctx, "p", metav1.GetOptions{})
	if got.Labels["track"] != "canary" || got.Labels["app"] != "" {
		t.Errorf("labels: %v", got.Labels)
	}
	if err := PatchPodLabels(ctx, client, "harbor", "p", gen.LabelPatch{Set: &map[string]string{"bad key!": "x"}}); !errors.As(err, &ve) {
		t.Errorf("bad label: %v", err)
	}
	if _, err := CreateDeployment(ctx, client, gen.CreateDeploymentRequest{Ns: "harbor", Name: "courier", Image: "x", Replicas: 1}); err != nil {
		t.Fatal(err)
	}
	if err := PatchDeploymentLabels(ctx, client, "harbor", "courier", gen.LabelPatch{Remove: &[]string{"app"}}); !errors.As(err, &ve) {
		t.Errorf("removing a selector label must be refused: %v", err)
	}
	if err := PatchDeploymentLabels(ctx, client, "harbor", "courier", gen.LabelPatch{Set: &map[string]string{"track": "blue"}}); err != nil {
		t.Fatal(err)
	}
	d, _ := client.AppsV1().Deployments("harbor").Get(ctx, "courier", metav1.GetOptions{})
	if d.Spec.Template.Labels["track"] != "blue" || d.Spec.Template.Labels["app"] != "courier" {
		t.Errorf("template labels: %v", d.Spec.Template.Labels)
	}
	if ms := ManagersOf(map[string]any{"managedFields": []any{map[string]any{"manager": "kubelet", "time": "2026-01-01T00:00:02Z"}, map[string]any{"manager": "kube-scheduler", "time": "2026-01-01T00:00:01Z"}, map[string]any{"manager": "kubelet", "time": "2026-01-01T00:00:03Z"}}}); len(ms) != 2 || ms[0] != "kube-scheduler" || ms[1] != "kubelet" {
		t.Errorf("managers: %v", ms)
	}
}
