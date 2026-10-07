package kube

import (
	"context"
	"errors"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

func ptr[T any](v T) *T { return &v }

func TestBuildDeploymentValidation(t *testing.T) {
	for name, req := range map[string]gen.CreateDeploymentRequest{
		"bad name": {Ns: "sandbox", Name: "Bad_Name", Image: "nginx", Replicas: 1},
		"bad ns":   {Ns: "Sand box", Name: "web", Image: "nginx", Replicas: 1},
		"no image": {Ns: "sandbox", Name: "web", Image: "  ", Replicas: 1},
		"neg":      {Ns: "sandbox", Name: "web", Image: "nginx", Replicas: -1},
		"bad port": {Ns: "sandbox", Name: "web", Image: "nginx", Replicas: 1, Port: ptr(70000)},
		"bad cpu":  {Ns: "sandbox", Name: "web", Image: "nginx", Replicas: 1, CpuRequest: ptr("lots")},
	} {
		_, err := BuildDeployment(req)
		var ve *ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
	}
}

func TestBuildDeploymentManifest(t *testing.T) {
	d, err := BuildDeployment(gen.CreateDeploymentRequest{
		Ns: "sandbox", Name: "web", Image: " nginx:1.27 ", Replicas: 3, Port: ptr(8080),
		MapPos: &gen.MapPos{X: 4, Y: 2}, CpuRequest: ptr("100m"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if *d.Spec.Replicas != 3 || d.Spec.Selector.MatchLabels["app"] != "web" || d.Spec.Template.Labels["app"] != "web" {
		t.Errorf("selector/labels wrong: %+v", d.Spec)
	}
	c := d.Spec.Template.Spec.Containers[0]
	if c.Image != "nginx:1.27" || c.Ports[0].ContainerPort != 8080 {
		t.Errorf("container: %+v", c)
	}
	if c.Resources.Requests.Cpu().MilliValue() != 100 || c.Resources.Requests.Memory().String() != "64Mi" {
		t.Errorf("requests: %v", c.Resources.Requests)
	}
	if d.Annotations[MapPosAnnotation] != "4,2" || d.Labels[ManagedByLabel] != "harbor" {
		t.Errorf("meta: %v %v", d.Annotations, d.Labels)
	}
}

func TestCreateScaleAndMapPosAgainstFake(t *testing.T) {
	ctx := context.Background()
	client := fake.NewClientset(
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web-a", Namespace: "sandbox"}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web-b", Namespace: "sandbox"}},
	)
	if _, err := CreateDeployment(ctx, client, gen.CreateDeploymentRequest{Ns: "sandbox", Name: "web", Image: "nginx", Replicas: 2}); err != nil {
		t.Fatal(err)
	}
	if _, err := CreateDeployment(ctx, client, gen.CreateDeploymentRequest{Ns: "sandbox", Name: "web", Image: "nginx", Replicas: 2}); err == nil {
		t.Error("second create should fail with AlreadyExists")
	}

	if err := ScaleDeployment(ctx, client, "sandbox", "web", 1, []string{"web-a"}); err != nil {
		t.Fatal(err)
	}
	d, _ := client.AppsV1().Deployments("sandbox").Get(ctx, "web", metav1.GetOptions{})
	if *d.Spec.Replicas != 1 {
		t.Errorf("replicas = %d, want 1", *d.Spec.Replicas)
	}
	pa, _ := client.CoreV1().Pods("sandbox").Get(ctx, "web-a", metav1.GetOptions{})
	pb, _ := client.CoreV1().Pods("sandbox").Get(ctx, "web-b", metav1.GetOptions{})
	if pa.Annotations[podDeletionCost] != retireCost || pb.Annotations[podDeletionCost] != "" {
		t.Errorf("deletion cost: a=%v b=%v", pa.Annotations, pb.Annotations)
	}
	if err := ScaleDeployment(ctx, client, "sandbox", "web", 1, []string{"ghost"}); err == nil {
		t.Error("retiring a missing pod should fail")
	}

	if err := SetMapPos(ctx, client, "sandbox", "web", gen.MapPos{X: 7, Y: 9}); err != nil {
		t.Fatal(err)
	}
	d, _ = client.AppsV1().Deployments("sandbox").Get(ctx, "web", metav1.GetOptions{})
	if d.Annotations[MapPosAnnotation] != "7,9" {
		t.Errorf("mapPos annotation = %q", d.Annotations[MapPosAnnotation])
	}
	if got := ConvertDeployment(d); got.MapPos == nil || got.MapPos.X != 7 {
		t.Errorf("round trip through ConvertDeployment: %+v", got.MapPos)
	}
	var _ *appsv1.Deployment = d

	if err := DeletePod(ctx, client, "sandbox", "web-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CoreV1().Pods("sandbox").Get(ctx, "web-a", metav1.GetOptions{}); err == nil {
		t.Error("pod should be gone")
	}
	if err := DeleteDeployment(ctx, client, "sandbox", "web"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.AppsV1().Deployments("sandbox").Get(ctx, "web", metav1.GetOptions{}); err == nil {
		t.Error("deployment should be gone")
	}
	if err := DeleteDeployment(ctx, client, "sandbox", "web"); err == nil {
		t.Error("deleting twice should fail with NotFound")
	}
}
