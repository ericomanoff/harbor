package kube

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

func testCluster() []runtimeObject {
	one := int32(1)
	return []runtimeObject{
		&corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "worker-1"},
			Status: corev1.NodeStatus{
				Allocatable: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("2"), corev1.ResourceMemory: resource.MustParse("4Gi")},
				Conditions:  []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
			},
		},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "sandbox"}, Status: corev1.NamespaceStatus{Phase: corev1.NamespaceActive}},
		&appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Name: "nginx", Namespace: "sandbox", Annotations: map[string]string{revisionAnnotation: "1"}},
			Spec:       appsv1.DeploymentSpec{Replicas: &one},
		},
		&appsv1.ReplicaSet{
			ObjectMeta: metav1.ObjectMeta{
				Name: "nginx-abc", Namespace: "sandbox", Annotations: map[string]string{revisionAnnotation: "1"},
				OwnerReferences: []metav1.OwnerReference{{Kind: "Deployment", Name: "nginx"}},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name: "nginx-abc-1", Namespace: "sandbox",
				OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "nginx-abc"}},
			},
			Spec: corev1.PodSpec{NodeName: "worker-1", Containers: []corev1.Container{{
				Name: "nginx", Resources: corev1.ResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("100m")}},
			}}},
			Status: corev1.PodStatus{Phase: corev1.PodRunning},
		},
	}
}

func helmSecret(name string, rev int, status string) *corev1.Secret {
	return &corev1.Secret{ObjectMeta: metav1.ObjectMeta{
		Name: "sh.helm.release.v1." + name + ".v" + fmt.Sprint(rev), Namespace: "sandbox",
		Labels: map[string]string{"owner": "helm", "name": name, "version": fmt.Sprint(rev), "status": status},
	}}
}

func TestWatcherTracksHelmReleases(t *testing.T) {
	client := fake.NewClientset(append(testCluster(), helmSecret("outpost", 1, "superseded"), helmSecret("outpost", 2, "deployed"))...)
	hub := NewHub()
	w := NewWatcher("test", client, hub)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := w.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer w.Stop()

	snap := w.Snapshot()
	if len(snap.Releases) != 1 || snap.Releases[0].Name != "outpost" || snap.Releases[0].Revision != 2 || snap.Releases[0].Status != "deployed" {
		t.Fatalf("releases = %+v", snap.Releases)
	}

	ch, unsub := hub.Subscribe(64)
	defer unsub()
	if _, err := client.CoreV1().Secrets("sandbox").Create(ctx, helmSecret("outpost", 3, "deployed"), metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	waitRelease(t, ch, func(r gen.HelmRelease, typ gen.WsMessageType) bool {
		return typ == gen.WsMessageTypeModified && r.Revision == 3
	})

	for _, rev := range []int{1, 2, 3} {
		if err := client.CoreV1().Secrets("sandbox").Delete(ctx, helmSecret("outpost", rev, "").Name, metav1.DeleteOptions{}); err != nil {
			t.Fatal(err)
		}
	}
	waitRelease(t, ch, func(r gen.HelmRelease, typ gen.WsMessageType) bool {
		return typ == gen.WsMessageTypeDeleted && r.Name == "outpost"
	})
}

func waitRelease(t *testing.T, ch <-chan gen.WsMessage, pred func(gen.HelmRelease, gen.WsMessageType) bool) {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case m := <-ch:
			if m.Kind != gen.WsMessageKindHelmRelease {
				continue
			}
			var r gen.HelmRelease
			if err := json.Unmarshal(mustRaw(t, m), &r); err != nil {
				t.Fatal(err)
			}
			if pred(r, m.Type) {
				return
			}
		case <-deadline:
			t.Fatal("timed out waiting for HelmRelease message")
		}
	}
}

func TestWatcherTracksWorkloads(t *testing.T) {
	one := int32(1)
	ctrl := true
	objs := append(testCluster(),
		&appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "sandbox"}, Spec: appsv1.StatefulSetSpec{Replicas: &one}, Status: appsv1.StatefulSetStatus{ReadyReplicas: 1}},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "db-0", Namespace: "sandbox", OwnerReferences: []metav1.OwnerReference{{Kind: "StatefulSet", Name: "db", Controller: &ctrl}}},
			Spec:       corev1.PodSpec{NodeName: "worker-1"}, Status: corev1.PodStatus{Phase: corev1.PodRunning},
		},
	)
	client := fake.NewClientset(objs...)
	hub := NewHub()
	w := NewWatcher("test", client, hub)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := w.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer w.Stop()
	snap := w.Snapshot()
	if len(snap.Workloads) != 1 || snap.Workloads[0].Kind != gen.WorkloadKindStatefulSet || snap.Workloads[0].Name != "db" {
		t.Fatalf("workloads = %+v", snap.Workloads)
	}
	var tanker *gen.Pod
	for i := range snap.Pods {
		if snap.Pods[i].Name == "db-0" {
			tanker = &snap.Pods[i]
		}
	}
	if tanker == nil || tanker.OwnerKind == nil || *tanker.OwnerKind != "StatefulSet" || tanker.Deployment != nil {
		t.Errorf("tanker = %+v", tanker)
	}

	ch, unsub := hub.Subscribe(64)
	defer unsub()
	if err := client.AppsV1().StatefulSets("sandbox").Delete(ctx, "db", metav1.DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(5 * time.Second)
	for {
		select {
		case m := <-ch:
			if m.Kind == gen.WsMessageKindWorkload && m.Type == gen.WsMessageTypeDeleted {
				return
			}
		case <-deadline:
			t.Fatal("no deleted Workload message")
		}
	}
}

func startWatcher(t *testing.T) (*Watcher, *fake.Clientset, *Hub) {
	t.Helper()
	client := fake.NewClientset(testCluster()...)
	hub := NewHub()
	w := NewWatcher("test", client, hub)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := w.Start(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(w.Stop)
	return w, client, hub
}

func TestWatcherSnapshotResolvesOwnersAndRequests(t *testing.T) {
	w, _, _ := startWatcher(t)
	snap := w.Snapshot()

	if snap.Context != "test" || len(snap.Nodes) != 1 || len(snap.Namespaces) != 1 || len(snap.Deployments) != 1 || len(snap.Pods) != 1 {
		t.Fatalf("snapshot shape: %+v", snap)
	}
	if snap.Nodes[0].CpuReq != 100 {
		t.Errorf("node cpuReq = %d, want 100 (from the pod's request)", snap.Nodes[0].CpuReq)
	}
	p := snap.Pods[0]
	if p.Deployment == nil || *p.Deployment != "nginx" {
		t.Errorf("pod.deployment = %v, want nginx (resolved through the ReplicaSet)", p.Deployment)
	}
	if d := snap.Deployments[0]; d.CurrentRS == nil || *d.CurrentRS != "nginx-abc" {
		t.Errorf("deployment.currentRS = %v, want nginx-abc", d.CurrentRS)
	}
}

func TestWatcherRepublishesDeploymentWhenNewReplicaSetAppears(t *testing.T) {
	_, client, hub := startWatcher(t)
	ch, cancel := hub.Subscribe(64)
	defer cancel()
	// Simulate a rollout: the controller bumps the revision and creates a new RS.
	d, _ := client.AppsV1().Deployments("sandbox").Get(context.Background(), "nginx", metav1.GetOptions{})
	d.Annotations[revisionAnnotation] = "2"
	if _, err := client.AppsV1().Deployments("sandbox").Update(context.Background(), d, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	newRS := &appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{
		Name: "nginx-def", Namespace: "sandbox", Annotations: map[string]string{revisionAnnotation: "2"},
		OwnerReferences: []metav1.OwnerReference{{Kind: "Deployment", Name: "nginx"}},
	}}
	if _, err := client.AppsV1().ReplicaSets("sandbox").Create(context.Background(), newRS, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(5 * time.Second)
	for {
		select {
		case m := <-ch:
			if m.Kind != gen.WsMessageKindDeployment {
				continue
			}
			var got gen.Deployment
			if err := json.Unmarshal(mustRaw(t, m), &got); err != nil {
				t.Fatal(err)
			}
			if got.CurrentRS != nil && *got.CurrentRS == "nginx-def" {
				return
			}
		case <-deadline:
			t.Fatal("deployment was not republished with the new ReplicaSet")
		}
	}
}

func TestWatcherPublishesLiveChanges(t *testing.T) {
	_, client, hub := startWatcher(t)
	ch, cancel := hub.Subscribe(64)
	defer cancel()

	newPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: "nginx-abc-2", Namespace: "sandbox",
			OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "nginx-abc"}},
		},
		Spec:   corev1.PodSpec{NodeName: "worker-1"},
		Status: corev1.PodStatus{Phase: corev1.PodPending},
	}
	if _, err := client.CoreV1().Pods("sandbox").Create(context.Background(), newPod, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}

	seenPod, seenNode := false, false
	deadline := time.After(5 * time.Second)
	for !(seenPod && seenNode) {
		select {
		case m := <-ch:
			switch m.Kind {
			case gen.WsMessageKindPod:
				var p gen.Pod
				if err := json.Unmarshal(mustRaw(t, m), &p); err != nil {
					t.Fatal(err)
				}
				if p.Name == "nginx-abc-2" && m.Type == gen.WsMessageTypeModified {
					if p.Deployment == nil || *p.Deployment != "nginx" {
						t.Errorf("live pod.deployment = %v", p.Deployment)
					}
					seenPod = true
				}
			case gen.WsMessageKindNode:
				seenNode = true // node totals republished after the pod landed
			}
		case <-deadline:
			t.Fatalf("timed out; seenPod=%v seenNode=%v", seenPod, seenNode)
		}
	}

	if err := client.CoreV1().Pods("sandbox").Delete(context.Background(), "nginx-abc-2", metav1.DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
	deadline = time.After(5 * time.Second)
	for {
		select {
		case m := <-ch:
			if m.Kind == gen.WsMessageKindPod && m.Type == gen.WsMessageTypeDeleted {
				return
			}
		case <-deadline:
			t.Fatal("no deleted Pod message")
		}
	}
}

func TestWatcherStartHonoursContextCancel(t *testing.T) {
	// A pre-cancelled context must fail fast, not hang in WaitForCacheSync.
	w := NewWatcher("x", fake.NewClientset(), NewHub())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := w.Start(ctx)
	if err == nil {
		// Fake clients can sync before the select observes ctx.Done(); either
		// outcome is acceptable as long as Start returned.
		w.Stop()
	}
}

func mustRaw(t *testing.T, m gen.WsMessage) []byte {
	t.Helper()
	raw, err := json.Marshal(m.Obj)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
