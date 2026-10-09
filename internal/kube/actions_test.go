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

func TestWorkloadActions(t *testing.T) {
	ctx := context.Background()
	one := int32(1)
	client := fake.NewClientset(
		&appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "a"}, Spec: appsv1.StatefulSetSpec{Replicas: &one}},
		&appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Name: "agent", Namespace: "a"}},
	)
	if err := ScaleStatefulSet(ctx, client, "a", "db", 3); err != nil {
		t.Fatal(err)
	}
	ss, _ := client.AppsV1().StatefulSets("a").Get(ctx, "db", metav1.GetOptions{})
	if *ss.Spec.Replicas != 3 {
		t.Errorf("replicas = %d", *ss.Spec.Replicas)
	}
	if err := SetWorkloadMapPos(ctx, client, gen.WorkloadKindStatefulSet, "a", "db", gen.MapPos{X: 2, Y: 5}); err != nil {
		t.Fatal(err)
	}
	ss, _ = client.AppsV1().StatefulSets("a").Get(ctx, "db", metav1.GetOptions{})
	if ss.Annotations[MapPosAnnotation] != "2,5" {
		t.Errorf("mappos = %q", ss.Annotations[MapPosAnnotation])
	}
	if err := SetWorkloadMapPos(ctx, client, gen.WorkloadKindDaemonSet, "a", "agent", gen.MapPos{}); err == nil {
		t.Error("daemonsets have no structure to place")
	}
	if err := DeleteWorkload(ctx, client, gen.WorkloadKindDaemonSet, "a", "agent"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.AppsV1().DaemonSets("a").Get(ctx, "agent", metav1.GetOptions{}); err == nil {
		t.Error("daemonset should be gone")
	}
	if err := DeleteWorkload(ctx, client, gen.WorkloadKindJob, "a", "nope"); err == nil {
		t.Error("deleting a missing job should fail")
	}
}

func TestBuildStatefulSet(t *testing.T) {
	ss, svc, err := BuildStatefulSet(gen.CreateStatefulSetRequest{
		Ns: "a", Name: "db", Image: "postgres:16", Replicas: 2, Port: ptr(5432),
		Storage: ptr("1Gi"), MountPath: ptr("/var/lib/pg"), StorageClass: ptr("standard"), MapPos: &gen.MapPos{X: 1, Y: 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	if *ss.Spec.Replicas != 2 || ss.Spec.ServiceName != "db" || ss.Spec.Selector.MatchLabels["app"] != "db" || ss.Annotations[MapPosAnnotation] != "1,2" {
		t.Errorf("statefulset = %+v", ss.Spec)
	}
	c := ss.Spec.Template.Spec.Containers[0]
	if c.Ports[0].ContainerPort != 5432 || c.VolumeMounts[0].MountPath != "/var/lib/pg" || c.VolumeMounts[0].Name != "data" {
		t.Errorf("container = %+v", c)
	}
	if len(ss.Spec.VolumeClaimTemplates) != 1 || *ss.Spec.VolumeClaimTemplates[0].Spec.StorageClassName != "standard" {
		t.Errorf("claims = %+v", ss.Spec.VolumeClaimTemplates)
	}
	if svc.Spec.ClusterIP != "None" || svc.Spec.Selector["app"] != "db" || svc.Spec.Ports[0].Port != 5432 || svc.Labels[ManagedByLabel] != "harbor" {
		t.Errorf("headless service = %+v", svc.Spec)
	}
	plain, _, err := BuildStatefulSet(gen.CreateStatefulSetRequest{Ns: "a", Name: "db", Image: "x", Replicas: 1})
	if err != nil || len(plain.Spec.VolumeClaimTemplates) != 0 || len(plain.Spec.Template.Spec.Containers[0].VolumeMounts) != 0 {
		t.Errorf("no storage requested but got claims: %v (%v)", plain.Spec.VolumeClaimTemplates, err)
	}
	for name, req := range map[string]gen.CreateStatefulSetRequest{
		"bad storage": {Ns: "a", Name: "db", Image: "x", Replicas: 1, Storage: ptr("lots")},
		"bad mount":   {Ns: "a", Name: "db", Image: "x", Replicas: 1, Storage: ptr("1Gi"), MountPath: ptr("data")},
		"bad name":    {Ns: "a", Name: "DB", Image: "x", Replicas: 1},
	} {
		if _, _, err := BuildStatefulSet(req); err == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
}

func TestCreateAndDeleteStatefulSetWithHeadlessService(t *testing.T) {
	ctx := context.Background()
	client := fake.NewClientset()
	if _, err := CreateStatefulSet(ctx, client, gen.CreateStatefulSetRequest{Ns: "a", Name: "db", Image: "x", Replicas: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CoreV1().Services("a").Get(ctx, "db", metav1.GetOptions{}); err != nil {
		t.Fatalf("headless service missing: %v", err)
	}
	// Creating again reuses the service and fails on the StatefulSet.
	if _, err := CreateStatefulSet(ctx, client, gen.CreateStatefulSetRequest{Ns: "a", Name: "db", Image: "x", Replicas: 1}); err == nil {
		t.Error("second create should fail")
	}
	if err := DeleteWorkload(ctx, client, gen.WorkloadKindStatefulSet, "a", "db"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CoreV1().Services("a").Get(ctx, "db", metav1.GetOptions{}); err == nil {
		t.Error("the headless service harbor created should go with the terminal")
	}
}

func TestBuildIngress(t *testing.T) {
	ing, err := BuildIngress(gen.CreateIngressRequest{Ns: "a", Name: "gate", Host: ptr("shop.example"), Path: ptr("/api"), Service: "api", Port: "http", Class: ptr("nginx"), Tls: ptr(true), TlsSecret: ptr("shop-tls")})
	if err != nil {
		t.Fatal(err)
	}
	rule := ing.Spec.Rules[0]
	if rule.Host != "shop.example" || rule.HTTP.Paths[0].Path != "/api" || rule.HTTP.Paths[0].Backend.Service.Port.Name != "http" || *ing.Spec.IngressClassName != "nginx" {
		t.Errorf("ingress = %+v", ing.Spec)
	}
	if len(ing.Spec.TLS) != 1 || ing.Spec.TLS[0].SecretName != "shop-tls" || ing.Spec.TLS[0].Hosts[0] != "shop.example" {
		t.Errorf("tls = %+v", ing.Spec.TLS)
	}
	num, err := BuildIngress(gen.CreateIngressRequest{Ns: "a", Name: "g", Service: "web", Port: "80"})
	if err != nil || num.Spec.Rules[0].HTTP.Paths[0].Backend.Service.Port.Number != 80 || num.Spec.Rules[0].HTTP.Paths[0].Path != "/" || num.Spec.Rules[0].Host != "" || len(num.Spec.TLS) != 0 {
		t.Errorf("numeric port ingress = %+v (%v)", num.Spec, err)
	}
	for name, req := range map[string]gen.CreateIngressRequest{
		"no service": {Ns: "a", Name: "g", Port: "80"},
		"no port":    {Ns: "a", Name: "g", Service: "web"},
		"bad port":   {Ns: "a", Name: "g", Service: "web", Port: "99999"},
		"bad path":   {Ns: "a", Name: "g", Service: "web", Port: "80", Path: ptr("api")},
		"bad host":   {Ns: "a", Name: "g", Service: "web", Port: "80", Host: ptr("not a host")},
	} {
		if _, err := BuildIngress(req); err == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
}

func TestBuildJob(t *testing.T) {
	cmd := []string{"sh", "-c", "echo hi"}
	job, err := BuildJob(gen.CreateJobRequest{Ns: "a", Name: "haul", Image: "busybox", Command: &cmd, Completions: ptr(3), Parallelism: ptr(2), BackoffLimit: ptr(1), RestartPolicy: ptr(gen.OnFailure), TtlSeconds: ptr(60)})
	if err != nil {
		t.Fatal(err)
	}
	if *job.Spec.Completions != 3 || *job.Spec.Parallelism != 2 || *job.Spec.BackoffLimit != 1 || *job.Spec.TTLSecondsAfterFinished != 60 {
		t.Errorf("spec = %+v", job.Spec)
	}
	ps := job.Spec.Template.Spec
	if ps.RestartPolicy != corev1.RestartPolicyOnFailure || len(ps.Containers[0].Command) != 3 || job.Labels[ManagedByLabel] != "harbor" {
		t.Errorf("template = %+v", ps)
	}
	plain, err := BuildJob(gen.CreateJobRequest{Ns: "a", Name: "haul", Image: "busybox"})
	if err != nil || *plain.Spec.Completions != 1 || *plain.Spec.Parallelism != 1 || *plain.Spec.BackoffLimit != 3 || plain.Spec.TTLSecondsAfterFinished != nil || plain.Spec.Template.Spec.RestartPolicy != corev1.RestartPolicyNever || plain.Spec.Template.Spec.Containers[0].Command != nil {
		t.Errorf("defaults = %+v (%v)", plain.Spec, err)
	}
	for name, req := range map[string]gen.CreateJobRequest{
		"no image":  {Ns: "a", Name: "haul"},
		"zero runs": {Ns: "a", Name: "haul", Image: "x", Completions: ptr(0)},
		"neg retry": {Ns: "a", Name: "haul", Image: "x", BackoffLimit: ptr(-1)},
		"bad name":  {Ns: "a", Name: "Haul", Image: "x"},
	} {
		if _, err := BuildJob(req); err == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
	client := fake.NewClientset()
	if _, err := CreateJob(context.Background(), client, gen.CreateJobRequest{Ns: "a", Name: "haul", Image: "x"}); err != nil {
		t.Fatal(err)
	}
	if _, err := CreateJob(context.Background(), client, gen.CreateJobRequest{Ns: "a", Name: "haul", Image: "x"}); err == nil {
		t.Error("duplicate job should fail")
	}
}

func TestBuildDeploymentLookouts(t *testing.T) {
	d, err := BuildDeployment(gen.CreateDeploymentRequest{Ns: "harbor", Name: "courier", Image: "x", Replicas: 1, Port: ptr(8080), ReadinessPath: ptr("ready"), LivenessPath: ptr("/healthz")})
	if err != nil {
		t.Fatal(err)
	}
	c := d.Spec.Template.Spec.Containers[0]
	if c.ReadinessProbe == nil || c.ReadinessProbe.HTTPGet.Path != "/ready" || c.ReadinessProbe.HTTPGet.Port.IntValue() != 8080 {
		t.Errorf("readiness: %+v", c.ReadinessProbe)
	}
	if c.LivenessProbe == nil || c.LivenessProbe.HTTPGet.Path != "/healthz" || c.LivenessProbe.PeriodSeconds != 10 {
		t.Errorf("liveness: %+v", c.LivenessProbe)
	}
	if _, err := BuildDeployment(gen.CreateDeploymentRequest{Ns: "harbor", Name: "courier", Image: "x", Replicas: 1, ReadinessPath: ptr("/ready")}); err == nil {
		t.Error("probe without a port should be invalid")
	}
	// Converted back, the wire model summarises the lookouts.
	out := ConvertDeployment(d)
	if out.Readiness == nil || *out.Readiness != "http /ready" || out.Liveness == nil || *out.Liveness != "http /healthz" {
		t.Errorf("converted probes: %v %v", out.Readiness, out.Liveness)
	}
}

func TestBuildService(t *testing.T) {
	svc, err := BuildService(gen.CreateServiceRequest{Ns: "harbor", Name: "courier", Selector: map[string]string{"app": "courier"}, Port: 80, TargetPort: ptr(8080)})
	if err != nil {
		t.Fatal(err)
	}
	if svc.Spec.Type != corev1.ServiceTypeClusterIP || svc.Spec.Selector["app"] != "courier" || svc.Spec.Ports[0].Port != 80 || svc.Spec.Ports[0].TargetPort.IntValue() != 8080 {
		t.Errorf("service: %+v", svc.Spec)
	}
	if svc.Labels[ManagedByLabel] != managedByValue {
		t.Errorf("labels: %v", svc.Labels)
	}
	for name, req := range map[string]gen.CreateServiceRequest{
		"no selector": {Ns: "harbor", Name: "a", Port: 80},
		"bad port":    {Ns: "harbor", Name: "a", Selector: map[string]string{"app": "a"}, Port: 0},
		"bad type":    {Ns: "harbor", Name: "a", Selector: map[string]string{"app": "a"}, Port: 80, Type: ptr("ExternalName")},
	} {
		var ve *ValidationError
		if _, err := BuildService(req); !errors.As(err, &ve) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
	}
	ctx := context.Background()
	client := fake.NewClientset()
	if _, err := CreateService(ctx, client, gen.CreateServiceRequest{Ns: "harbor", Name: "courier", Selector: map[string]string{"app": "courier"}, Port: 80}); err != nil {
		t.Fatal(err)
	}
	if err := DeleteService(ctx, client, "harbor", "courier"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CoreV1().Services("harbor").Get(ctx, "courier", metav1.GetOptions{}); err == nil {
		t.Error("service should be gone")
	}
}

func TestBuildDeploymentLimitsAndOrders(t *testing.T) {
	d, err := BuildDeployment(gen.CreateDeploymentRequest{
		Ns: "harbor", Name: "hog", Image: "x", Replicas: 1, CpuRequest: ptr("100m"), MemRequest: ptr("64Mi"), CpuLimit: ptr("200m"), MemLimit: ptr("128Mi"),
		Orders: &[]gen.OrdersRef{{Kind: gen.OrdersKindConfigMap, Name: "hog-orders"}, {Kind: gen.OrdersKindSecret, Name: "hog-keys"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	c := d.Spec.Template.Spec.Containers[0]
	if c.Resources.Limits.Cpu().MilliValue() != 200 || c.Resources.Limits.Memory().String() != "128Mi" {
		t.Errorf("limits: %v", c.Resources.Limits)
	}
	if len(c.EnvFrom) != 2 || c.EnvFrom[0].ConfigMapRef.Name != "hog-orders" || c.EnvFrom[1].SecretRef.Name != "hog-keys" {
		t.Errorf("envFrom: %+v", c.EnvFrom)
	}
	out := ConvertDeployment(d)
	if out.Limits == nil || *out.Limits != "cpu 200m · mem 128Mi" || out.Requests == nil || *out.Requests != "cpu 100m · mem 64Mi" {
		t.Errorf("summaries: %v %v", out.Requests, out.Limits)
	}
	if out.Orders == nil || len(*out.Orders) != 2 || (*out.Orders)[0] != "ConfigMap/hog-orders" {
		t.Errorf("orders: %v", out.Orders)
	}
	if _, err := BuildDeployment(gen.CreateDeploymentRequest{Ns: "harbor", Name: "hog", Image: "x", Replicas: 1, CpuRequest: ptr("500m"), CpuLimit: ptr("200m")}); err == nil {
		t.Error("limit below request should be invalid")
	}
	if _, err := BuildDeployment(gen.CreateDeploymentRequest{Ns: "harbor", Name: "hog", Image: "x", Replicas: 1, MemLimit: ptr("lots")}); err == nil {
		t.Error("bad memLimit should be invalid")
	}
}

func TestOrders(t *testing.T) {
	ctx := context.Background()
	client := fake.NewClientset()
	cm, err := CreateOrders(ctx, client, gen.CreateOrdersRequest{Ns: "harbor", Name: "courier-orders", Kind: gen.OrdersKindConfigMap, Data: map[string]string{"PORT": "80", "GREETING": "ahoy"}})
	if err != nil {
		t.Fatal(err)
	}
	if cm.Kind != gen.OrdersKindConfigMap || len(cm.Keys) != 2 || cm.Keys[0] != "GREETING" {
		t.Errorf("configmap orders: %+v", cm)
	}
	sec, err := CreateOrders(ctx, client, gen.CreateOrdersRequest{Ns: "harbor", Name: "courier-keys", Kind: gen.OrdersKindSecret, Data: map[string]string{"API_KEY": "hush"}})
	if err != nil {
		t.Fatal(err)
	}
	if sec.Kind != gen.OrdersKindSecret || len(sec.Keys) != 1 || sec.Keys[0] != "API_KEY" {
		t.Errorf("secret orders: %+v", sec)
	}
	// Plumbing is not listed.
	if _, err := client.CoreV1().ConfigMaps("harbor").Create(ctx, &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "kube-root-ca.crt", Namespace: "harbor"}}, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CoreV1().Secrets("harbor").Create(ctx, &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "sh.helm.release.v1.x", Namespace: "harbor"}, Type: "helm.sh/release.v1"}, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	list, err := ListOrders(ctx, client, "harbor")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Errorf("list = %+v, want the two orders only", list)
	}
	for name, req := range map[string]gen.CreateOrdersRequest{
		"no data": {Ns: "harbor", Name: "a", Kind: gen.OrdersKindConfigMap, Data: map[string]string{}},
		"bad key": {Ns: "harbor", Name: "a", Kind: gen.OrdersKindConfigMap, Data: map[string]string{"bad key!": "x"}},
		"bad ns":  {Ns: "Harbor", Name: "a", Kind: gen.OrdersKindSecret, Data: map[string]string{"k": "x"}},
	} {
		var ve *ValidationError
		if _, err := CreateOrders(ctx, client, req); !errors.As(err, &ve) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
	}
	if err := DeleteOrders(ctx, client, gen.OrdersKindSecret, "harbor", "courier-keys"); err != nil {
		t.Fatal(err)
	}
	if list, _ = ListOrders(ctx, client, "harbor"); len(list) != 1 {
		t.Errorf("after delete: %+v", list)
	}
}
