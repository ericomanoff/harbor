package campaign

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	netv1 "k8s.io/api/networking/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/version"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

func TestBuiltinCampaignsLoadAndValidate(t *testing.T) {
	cs, errs := Load("")
	if len(errs) > 0 {
		t.Fatalf("builtin errors: %v", errs)
	}
	if len(cs) != 1 || cs[0].Id != "fortiaigate" || len(cs[0].Levels) != 7 {
		t.Fatalf("campaigns = %+v", cs)
	}
	if cs[0].Builtin == nil || !*cs[0].Builtin {
		t.Error("builtin flag missing")
	}
	for _, l := range cs[0].Levels {
		for _, s := range l.Steps {
			if s.Kind == "check" && !KnownProbe(*s.Probe) {
				t.Errorf("level %s uses unknown probe %s", l.Id, *s.Probe)
			}
		}
	}
}

func TestUserCampaignsOverrideAndBadOnesAreReported(t *testing.T) {
	dir := t.TempDir()
	good := `
id: fortiaigate
title: My own expedition
levels:
  - id: one
    title: One
    steps:
      - kind: instruct
        text: hello
      - kind: wait
        goal: { kind: namespace-exists, name: x }
`
	bad := `
id: broken
title: Broken
levels:
  - id: one
    title: One
    steps:
      - kind: check
        probe: rm-rf
`
	for name, data := range map[string]string{"mine": good, "broken": bad} {
		if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name, "campaign.yaml"), []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cs, errs := Load(dir)
	if len(errs) != 1 || !strings.Contains(errs[0].Error(), "whitelisted probe") {
		t.Errorf("errs = %v", errs)
	}
	if len(cs) != 1 || cs[0].Title != "My own expedition" || *cs[0].Builtin {
		t.Errorf("campaigns = %+v", cs)
	}
}

func TestValidateRejectsBadSteps(t *testing.T) {
	for name, src := range map[string]string{
		"unknown kind": "id: a\ntitle: A\nlevels:\n  - id: l\n    title: L\n    steps:\n      - kind: dance\n",
		"bad form":     "id: a\ntitle: A\nlevels:\n  - id: l\n    title: L\n    steps:\n      - kind: form\n        form: rocket\n",
		"bad goal":     "id: a\ntitle: A\nlevels:\n  - id: l\n    title: L\n    steps:\n      - kind: wait\n        goal: { kind: world-peace }\n",
		"dup level":    "id: a\ntitle: A\nlevels:\n  - id: l\n    title: L\n    steps: [{kind: instruct}]\n  - id: l\n    title: L2\n    steps: [{kind: instruct}]\n",
		"unknown key":  "id: a\ntitle: A\nlevels:\n  - id: l\n    title: L\n    steps: [{kind: instruct, exec: rm}]\n",
	} {
		if _, err := Parse([]byte(src)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestProbes(t *testing.T) {
	ctx := context.Background()
	client := fake.NewClientset(
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "gpu-1", Labels: map[string]string{"nvidia.com/gpu.present": "true"}}, Status: corev1.NodeStatus{NodeInfo: corev1.NodeSystemInfo{OperatingSystem: "linux", Architecture: "amd64"}}},
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "arm-1"}, Status: corev1.NodeStatus{NodeInfo: corev1.NodeSystemInfo{OperatingSystem: "linux", Architecture: "arm64"}}},
		&storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "nfs"}, Provisioner: "nfs.csi.k8s.io"},
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "sh.helm.release.v1.fx.v2", Namespace: "fx", Labels: map[string]string{"owner": "helm", "name": "fx", "status": "deployed", "version": "2"}}},
		&corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "models", Namespace: "fx"}, Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "ui", Namespace: "fx"}, Status: corev1.PodStatus{Phase: corev1.PodRunning, Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "worker", Namespace: "fx"}, Status: corev1.PodStatus{Phase: corev1.PodPending}},
		&netv1.Ingress{ObjectMeta: metav1.ObjectMeta{Name: "fx", Namespace: "fx"}, Status: netv1.IngressStatus{LoadBalancer: netv1.IngressLoadBalancerStatus{Ingress: []netv1.IngressLoadBalancerIngress{{IP: "10.0.0.9"}}}}},
	)
	client.Discovery().(*fakediscovery.FakeDiscovery).FakedServerVersion = &version.Info{GitVersion: "v1.31.2"}
	run := func(probe string, args map[string]string) gen.ProbeResult {
		t.Helper()
		r, err := Run(ctx, client, gen.ProbeRequest{Probe: probe, Args: &args})
		if err != nil {
			t.Fatalf("%s: %v", probe, err)
		}
		return r
	}
	cases := []struct {
		probe string
		args  map[string]string
		ok    bool
	}{
		{"kube-version", map[string]string{"min": "1.25"}, true},
		{"kube-version", map[string]string{"min": "1.40"}, false},
		{"node-arch", map[string]string{"arch": "linux/amd64"}, true},
		{"node-arch", map[string]string{"arch": "windows/amd64"}, false},
		{"node-label", map[string]string{"label": "nvidia.com/gpu.present=true"}, true},
		{"node-label", map[string]string{"label": "tpu=true"}, false},
		{"ingress-controller", nil, false},
		{"storage-class", map[string]string{"access": "rwx"}, true},
		{"storage-class", map[string]string{"name": "ceph"}, false},
		{"secret-exists", map[string]string{"ns": "fx", "name": "nope"}, false},
		{"release-deployed", map[string]string{"ns": "fx", "name": "fx"}, true},
		{"release-revision", map[string]string{"ns": "fx", "name": "fx", "min": "2"}, true},
		{"release-revision", map[string]string{"ns": "fx", "name": "fx", "min": "3"}, false},
		{"pvc-bound", map[string]string{"ns": "fx"}, true},
		{"pods-ready", map[string]string{"ns": "fx"}, false},
		{"ingress-address", map[string]string{"ns": "fx", "name": "fx"}, true},
		{"http", map[string]string{"url": "ftp://nope"}, false},
	}
	for _, c := range cases {
		if r := run(c.probe, c.args); r.Ok != c.ok {
			t.Errorf("%s %v: ok=%v (%s), want %v", c.probe, c.args, r.Ok, r.Message, c.ok)
		}
	}
	if _, err := Run(ctx, client, gen.ProbeRequest{Probe: "shell"}); err == nil {
		t.Error("unknown probe must be an error")
	}
	if versionLess("1.31.2", "1.25") || !versionLess("1.24.9", "1.25") {
		t.Error("versionLess is wrong")
	}
}
