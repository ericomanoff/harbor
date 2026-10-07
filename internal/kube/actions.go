package kube

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/kubernetes"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

const (
	// ManagedByLabel marks objects harbor created.
	ManagedByLabel = "app.kubernetes.io/managed-by"
	managedByValue = "harbor"
	// podDeletionCost is honoured by the ReplicaSet controller: lower cost
	// pods are deleted first on scale-down.
	podDeletionCost   = "controller.kubernetes.io/pod-deletion-cost"
	retireCost        = "-1000"
	defaultCPURequest = "50m"
	defaultMemRequest = "64Mi"
)

// ValidationError is a user mistake (400), as opposed to a cluster failure.
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func invalid(format string, args ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, args...)}
}

// BuildDeployment turns a create request into a Deployment manifest.
// It only validates shape; the API server has the final say.
func BuildDeployment(req gen.CreateDeploymentRequest) (*appsv1.Deployment, error) {
	if errs := validation.IsDNS1123Label(req.Name); len(errs) > 0 {
		return nil, invalid("name %q: %s", req.Name, strings.Join(errs, "; "))
	}
	if errs := validation.IsDNS1123Label(req.Ns); len(errs) > 0 {
		return nil, invalid("namespace %q: %s", req.Ns, strings.Join(errs, "; "))
	}
	if strings.TrimSpace(req.Image) == "" {
		return nil, invalid("image is required")
	}
	if req.Replicas < 0 {
		return nil, invalid("replicas must be >= 0")
	}
	cpu, mem := defaultCPURequest, defaultMemRequest
	if req.CpuRequest != nil && *req.CpuRequest != "" {
		cpu = *req.CpuRequest
	}
	if req.MemRequest != nil && *req.MemRequest != "" {
		mem = *req.MemRequest
	}
	cpuQ, err := resource.ParseQuantity(cpu)
	if err != nil {
		return nil, invalid("cpuRequest %q: %v", cpu, err)
	}
	memQ, err := resource.ParseQuantity(mem)
	if err != nil {
		return nil, invalid("memRequest %q: %v", mem, err)
	}

	labels := map[string]string{"app": req.Name, ManagedByLabel: managedByValue}
	annotations := map[string]string{}
	if req.MapPos != nil {
		annotations[MapPosAnnotation] = FormatMapPos(*req.MapPos)
	}
	container := corev1.Container{
		Name:  req.Name,
		Image: strings.TrimSpace(req.Image),
		Resources: corev1.ResourceRequirements{Requests: corev1.ResourceList{
			corev1.ResourceCPU:    cpuQ,
			corev1.ResourceMemory: memQ,
		}},
	}
	if req.Port != nil {
		if *req.Port < 1 || *req.Port > 65535 {
			return nil, invalid("port must be 1-65535")
		}
		container.Ports = []corev1.ContainerPort{{ContainerPort: int32(*req.Port), Name: "http"}}
	}
	replicas := int32(req.Replicas)
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: req.Name, Namespace: req.Ns, Labels: labels, Annotations: annotations},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": req.Name}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": req.Name}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{container}},
			},
		},
	}, nil
}

// CreateDeployment places a new War Factory.
func CreateDeployment(ctx context.Context, client kubernetes.Interface, req gen.CreateDeploymentRequest) (*appsv1.Deployment, error) {
	d, err := BuildDeployment(req)
	if err != nil {
		return nil, err
	}
	return client.AppsV1().Deployments(req.Ns).Create(ctx, d, metav1.CreateOptions{})
}

// ScaleDeployment sets replicas. Pods named in retireFirst are annotated
// with a low deletion cost first so a scale-down removes them before others.
func ScaleDeployment(ctx context.Context, client kubernetes.Interface, ns, name string, replicas int, retireFirst []string) error {
	if replicas < 0 {
		return invalid("replicas must be >= 0")
	}
	for _, pod := range retireFirst {
		patch := annotationPatch(podDeletionCost, retireCost)
		if _, err := client.CoreV1().Pods(ns).Patch(ctx, pod, types.MergePatchType, patch, metav1.PatchOptions{}); err != nil {
			return fmt.Errorf("mark pod %s for retirement: %w", pod, err)
		}
	}
	patch, _ := json.Marshal(map[string]any{"spec": map[string]any{"replicas": replicas}})
	_, err := client.AppsV1().Deployments(ns).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

// SetMapPos stores the building's tile in its annotation.
func SetMapPos(ctx context.Context, client kubernetes.Interface, ns, name string, mp gen.MapPos) error {
	patch := annotationPatch(MapPosAnnotation, FormatMapPos(mp))
	_, err := client.AppsV1().Deployments(ns).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

func annotationPatch(key, value string) []byte {
	b, _ := json.Marshal(map[string]any{"metadata": map[string]any{"annotations": map[string]string{key: value}}})
	return b
}
