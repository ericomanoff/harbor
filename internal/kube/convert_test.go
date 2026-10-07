package kube

import (
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

func TestParseMapPos(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want gen.MapPos
		ok   bool
	}{
		{"3,4", gen.MapPos{X: 3, Y: 4}, true},
		{" 10 , -2 ", gen.MapPos{X: 10, Y: -2}, true},
		{"", gen.MapPos{}, false},
		{"3", gen.MapPos{}, false},
		{"a,b", gen.MapPos{}, false},
	} {
		got, ok := ParseMapPos(tc.in)
		if ok != tc.ok || got != tc.want {
			t.Errorf("ParseMapPos(%q) = %v,%v want %v,%v", tc.in, got, ok, tc.want, tc.ok)
		}
	}
	if s := FormatMapPos(gen.MapPos{X: 7, Y: 9}); s != "7,9" {
		t.Errorf("FormatMapPos = %q", s)
	}
}

func podWithRequests(name, node, cpu, mem string, phase corev1.PodPhase) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default"},
		Spec: corev1.PodSpec{
			NodeName: node,
			Containers: []corev1.Container{{
				Name: "c",
				Resources: corev1.ResourceRequirements{Requests: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse(cpu),
					corev1.ResourceMemory: resource.MustParse(mem),
				}},
			}},
		},
		Status: corev1.PodStatus{Phase: phase},
	}
}

func TestConvertNodeSumsRequestsOfLivePods(t *testing.T) {
	n := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "worker-1", Labels: map[string]string{"zone": "a"}},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("4"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
			},
			Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
		},
	}
	pods := []*corev1.Pod{
		podWithRequests("a", "worker-1", "250m", "64Mi", corev1.PodRunning),
		podWithRequests("b", "worker-1", "100m", "32Mi", corev1.PodPending),
		podWithRequests("done", "worker-1", "1", "1Gi", corev1.PodSucceeded), // ignored
	}
	got := ConvertNode(n, pods)
	if !got.Ready || got.CpuAlloc != 4000 || got.MemAlloc != 8*1024*1024*1024 {
		t.Errorf("allocatable/ready wrong: %+v", got)
	}
	if got.CpuReq != 350 || got.MemReq != 96*1024*1024 {
		t.Errorf("requests = %d/%d, want 350/%d", got.CpuReq, got.MemReq, 96*1024*1024)
	}
	if got.Labels["zone"] != "a" {
		t.Errorf("labels not carried: %v", got.Labels)
	}
}

func TestConvertNodeNilLabelsBecomesEmptyMap(t *testing.T) {
	got := ConvertNode(&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "n"}}, nil)
	if got.Labels == nil {
		t.Fatal("labels should be an empty map, not nil, so JSON is {} not null")
	}
}

func TestConvertDeployment(t *testing.T) {
	three := int32(3)
	d := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name: "web", Namespace: "sandbox",
			Annotations: map[string]string{MapPosAnnotation: "12,7"},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &three,
			Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
				Containers: []corev1.Container{{Name: "web", Image: "nginx:1.27"}},
			}},
		},
		Status: appsv1.DeploymentStatus{
			AvailableReplicas: 2, UpdatedReplicas: 3,
			Conditions: []appsv1.DeploymentCondition{{Type: appsv1.DeploymentAvailable, Status: corev1.ConditionTrue, Reason: "MinimumReplicasAvailable"}},
		},
	}
	got := ConvertDeployment(d)
	if got.Ns != "sandbox" || got.Name != "web" || got.Replicas != 3 || got.Available != 2 || got.Updated != 3 || got.Image != "nginx:1.27" {
		t.Errorf("basic fields wrong: %+v", got)
	}
	if got.MapPos == nil || *got.MapPos != (gen.MapPos{X: 12, Y: 7}) {
		t.Errorf("mapPos = %v", got.MapPos)
	}
	if len(got.Conditions) != 1 || got.Conditions[0].Reason == nil || *got.Conditions[0].Reason != "MinimumReplicasAvailable" {
		t.Errorf("conditions = %+v", got.Conditions)
	}
}

func TestConvertDeploymentDefaultsReplicasToOne(t *testing.T) {
	got := ConvertDeployment(&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "d"}})
	if got.Replicas != 1 || got.MapPos != nil || got.Conditions == nil {
		t.Errorf("%+v", got)
	}
}

func TestConvertPodCrashLoop(t *testing.T) {
	p := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: "crashy-abc", Namespace: "sandbox",
			CreationTimestamp: metav1.NewTime(time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)),
			OwnerReferences:   []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "crashy-7d9"}},
		},
		Spec: corev1.PodSpec{NodeName: "worker-2"},
		Status: corev1.PodStatus{
			Phase:      corev1.PodRunning,
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionFalse}},
			ContainerStatuses: []corev1.ContainerStatus{
				{Name: "ok", Ready: true, RestartCount: 1, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}},
				{Name: "bad", Ready: false, RestartCount: 4, State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}}},
			},
		},
	}
	got := ConvertPod(p, "crashy")
	if got.Phase != "Running" || got.Ready || got.Restarts != 5 || got.Node != "worker-2" {
		t.Errorf("%+v", got)
	}
	if got.Reason == nil || *got.Reason != "CrashLoopBackOff" {
		t.Errorf("reason = %v", got.Reason)
	}
	if got.OwnerRS == nil || *got.OwnerRS != "crashy-7d9" || got.Deployment == nil || *got.Deployment != "crashy" {
		t.Errorf("owners = %v / %v", got.OwnerRS, got.Deployment)
	}
	if !got.Created.Equal(p.CreationTimestamp.Time) {
		t.Errorf("created = %v", got.Created)
	}
}

func TestConvertPodTerminatingAndEvicted(t *testing.T) {
	now := metav1.Now()
	term := ConvertPod(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "t", DeletionTimestamp: &now},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}, "")
	if term.Phase != "Terminating" || term.Deployment != nil || term.Reason != nil {
		t.Errorf("terminating: %+v", term)
	}
	ev := ConvertPod(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "e"},
		Status:     corev1.PodStatus{Phase: corev1.PodFailed, Reason: "Evicted"},
	}, "")
	if ev.Reason == nil || *ev.Reason != "Evicted" {
		t.Errorf("evicted: %+v", ev)
	}
}

func TestWorseReasonPrefersCrashLoop(t *testing.T) {
	if r := worseReason("ContainerCreating", "CrashLoopBackOff"); r != "CrashLoopBackOff" {
		t.Errorf("got %q", r)
	}
	if r := worseReason("CrashLoopBackOff", "ContainerCreating"); r != "CrashLoopBackOff" {
		t.Errorf("got %q", r)
	}
}

func TestConvertEventTimestampFallback(t *testing.T) {
	ts := time.Date(2026, 10, 7, 1, 2, 3, 0, time.UTC)
	e := &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Namespace: "sandbox", CreationTimestamp: metav1.NewTime(ts)},
		InvolvedObject: corev1.ObjectReference{Kind: "Pod", Name: "crashy-abc"},
		Type:           "Warning", Reason: "BackOff", Message: "Back-off restarting failed container",
	}
	got := ConvertEvent(e)
	if got.Kind != "Pod" || got.Name != "crashy-abc" || got.Type != "Warning" || !got.Ts.Equal(ts) {
		t.Errorf("%+v", got)
	}
	e.LastTimestamp = metav1.NewTime(ts.Add(time.Hour))
	if !ConvertEvent(e).Ts.Equal(ts.Add(time.Hour)) {
		t.Error("lastTimestamp should win")
	}
}

func TestCurrentReplicaSet(t *testing.T) {
	d := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{
		Name: "web", Namespace: "a", Annotations: map[string]string{revisionAnnotation: "3"},
	}}
	rs := func(name, ns, owner, rev string) *appsv1.ReplicaSet {
		return &appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: ns, Annotations: map[string]string{revisionAnnotation: rev},
			OwnerReferences: []metav1.OwnerReference{{Kind: "Deployment", Name: owner}},
		}}
	}
	sets := []*appsv1.ReplicaSet{
		rs("web-old", "a", "web", "2"),
		rs("web-new", "a", "web", "3"),
		rs("other-9", "a", "other", "9"),
		rs("web-elsewhere", "b", "web", "3"),
	}
	if got := CurrentReplicaSet(d, sets); got != "web-new" {
		t.Errorf("by revision = %q, want web-new", got)
	}
	d.Annotations = nil
	if got := CurrentReplicaSet(d, sets); got != "web-new" {
		t.Errorf("highest fallback = %q, want web-new", got)
	}
	if got := CurrentReplicaSet(d, nil); got != "" {
		t.Errorf("no sets = %q, want empty", got)
	}
}

func TestConvertHelmSecret(t *testing.T) {
	sec := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{
		Name: "sh.helm.release.v1.outpost.v3", Namespace: "sandbox",
		Labels: map[string]string{"owner": "helm", "name": "outpost", "version": "3", "status": "deployed", "modifiedAt": "1760000000"},
	}}
	r, ok := ConvertHelmSecret(sec)
	if !ok || r.Ns != "sandbox" || r.Name != "outpost" || r.Revision != 3 || r.Status != "deployed" || r.Updated == nil || r.Updated.Unix() != 1760000000 {
		t.Errorf("%+v %v", r, ok)
	}
	if _, ok := ConvertHelmSecret(&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"owner": "other"}}}); ok {
		t.Error("non-helm secret accepted")
	}
}

func TestConvertDeploymentRelease(t *testing.T) {
	d := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "web", Annotations: map[string]string{"meta.helm.sh/release-name": "outpost"}}}
	if got := ConvertDeployment(d); got.Release == nil || *got.Release != "outpost" {
		t.Errorf("release = %v", got.Release)
	}
	if got := ConvertDeployment(&appsv1.Deployment{}); got.Release != nil {
		t.Errorf("no annotation should mean no release, got %v", *got.Release)
	}
}
