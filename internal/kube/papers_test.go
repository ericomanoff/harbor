package kube

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// A Node has papers like any namespaced object: cluster-scoped, so the
// namespace is ignored; its labels land in the metadata and its status
// (capacity, conditions) in the status.
func TestPapersNode(t *testing.T) {
	client := fake.NewClientset(&corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "w1", Labels: map[string]string{"node-role.kubernetes.io/worker": ""}},
		Status:     corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}},
	})
	out, err := Papers(context.Background(), client, "Node", "-", "w1")
	if err != nil {
		t.Fatal(err)
	}
	if out.Kind != "Node" || !strings.Contains(out.Metadata, "node-role.kubernetes.io/worker") || !strings.Contains(out.Status, "Ready") {
		t.Errorf("node papers: %+v", out)
	}
	if _, err := Papers(context.Background(), client, "Secret", "sandbox", "x"); err == nil {
		t.Error("secret papers should be refused")
	}
}
