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

func TestStageIncidents(t *testing.T) {
	ctx := context.Background()
	client := fake.NewClientset()
	ns := "harbor-academy"
	var ve *ValidationError
	if _, err := Stage(ctx, client, "found", gen.StageRequest{Ns: ptr("sandbox")}); !errors.As(err, &ve) {
		t.Errorf("found outside harbor-academy*: err = %v, want ValidationError", err)
	}
	if _, err := Stage(ctx, client, "found", gen.StageRequest{Ns: ptr(ns)}); err != nil {
		t.Fatal(err)
	}
	if _, err := Stage(ctx, client, "found", gen.StageRequest{Ns: ptr(ns)}); err != nil {
		t.Errorf("found twice should be fine: %v", err)
	}
	// Incidents refuse namespaces the academy did not found.
	if _, err := client.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "prod"}}, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := Stage(ctx, client, "lone-ship", gen.StageRequest{Ns: ptr("prod"), Name: ptr("x")}); !errors.As(err, &ve) {
		t.Errorf("lone-ship in prod: err = %v, want ValidationError", err)
	}
	res, err := Stage(ctx, client, "lone-ship", gen.StageRequest{Ns: ptr(ns), Name: ptr("courier")})
	if err != nil || res.Name == nil || *res.Name != "courier" {
		t.Fatalf("lone-ship: %+v %v", res, err)
	}
	pod, err := client.CoreV1().Pods(ns).Get(ctx, "courier", metav1.GetOptions{})
	if err != nil || pod.Labels[StagedLabel] != "true" || pod.Spec.Containers[0].Image != defaultShip {
		t.Errorf("pod: %+v %v", pod, err)
	}
	if _, err := Stage(ctx, client, "sink-pod", gen.StageRequest{Ns: ptr(ns), Name: ptr("courier")}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CoreV1().Pods(ns).Get(ctx, "courier", metav1.GetOptions{}); err == nil {
		t.Error("pod should be sunk")
	}
	if _, err := CreateDeployment(ctx, client, gen.CreateDeploymentRequest{Ns: ns, Name: "courier", Image: "nginx:1.27-alpine", Replicas: 1}); err != nil {
		t.Fatal(err)
	}
	res, err = Stage(ctx, client, "bad-refit", gen.StageRequest{Ns: ptr(ns), Name: ptr("courier")})
	if err != nil || res.Name == nil || !strings.HasPrefix(*res.Name, "nginx:broken-") {
		t.Fatalf("bad-refit: %+v %v", res, err)
	}
	// Drain cordons the node and evicts only the academy fleet's pods.
	if _, err := client.CoreV1().Nodes().Create(ctx, &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "w1"}}, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CoreV1().Pods(ns).Create(ctx, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "mine", Namespace: ns}, Spec: corev1.PodSpec{NodeName: "w1"}}, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CoreV1().Pods("prod").Create(ctx, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "theirs", Namespace: "prod"}, Spec: corev1.PodSpec{NodeName: "w1"}}, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := Stage(ctx, client, "drain", gen.StageRequest{Ns: ptr(ns), Node: ptr("w1")}); err != nil {
		t.Fatal(err)
	}
	if n, _ := client.CoreV1().Nodes().Get(ctx, "w1", metav1.GetOptions{}); !n.Spec.Unschedulable {
		t.Error("drain should cordon")
	}
	if _, err := client.CoreV1().Pods("prod").Get(ctx, "theirs", metav1.GetOptions{}); err != nil {
		t.Error("drain must not touch other namespaces")
	}
	if _, err := Stage(ctx, client, "uncordon", gen.StageRequest{Ns: ptr(ns), Node: ptr("w1")}); err != nil {
		t.Fatal(err)
	}
	if n, _ := client.CoreV1().Nodes().Get(ctx, "w1", metav1.GetOptions{}); n.Spec.Unschedulable {
		t.Error("uncordon should open the node")
	}
	if _, err := Stage(ctx, client, "quota", gen.StageRequest{Ns: ptr(ns)}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CoreV1().ResourceQuotas(ns).Get(ctx, "harbor-authority", metav1.GetOptions{}); err != nil {
		t.Error("quota should exist")
	}
	if _, err := Stage(ctx, client, "quota", gen.StageRequest{Ns: ptr(ns)}); err != nil {
		t.Errorf("quota twice should be fine: %v", err)
	}
	if _, err := Stage(ctx, client, "storm", gen.StageRequest{Ns: ptr(ns)}); !errors.As(err, &ve) {
		t.Errorf("unknown incident: err = %v, want ValidationError", err)
	}
	res, err = Stage(ctx, client, "cleanup", gen.StageRequest{})
	if err != nil || !strings.HasPrefix(res.Message, "1 ") {
		t.Errorf("cleanup: %+v %v", res, err)
	}
	if _, err := client.CoreV1().Namespaces().Get(ctx, "prod", metav1.GetOptions{}); err != nil {
		t.Error("cleanup must leave other namespaces alone")
	}
}
