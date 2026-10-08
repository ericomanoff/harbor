package kube

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	netv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
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

// DeleteDeployment sells a structure. Background propagation lets the API
// answer at once while the garbage collector removes the pods.
func DeleteDeployment(ctx context.Context, client kubernetes.Interface, ns, name string) error {
	policy := metav1.DeletePropagationBackground
	return client.AppsV1().Deployments(ns).Delete(ctx, name, metav1.DeleteOptions{PropagationPolicy: &policy})
}

// DeletePod repairs a unit: the ReplicaSet replaces it with a fresh one.
func DeletePod(ctx context.Context, client kubernetes.Interface, ns, name string) error {
	return client.CoreV1().Pods(ns).Delete(ctx, name, metav1.DeleteOptions{})
}

// PodLogs streams the tail of a container's log. An empty container means
// the pod's default (first) container.
func PodLogs(ctx context.Context, client kubernetes.Interface, ns, name, container string, tail int64) (io.ReadCloser, error) {
	if tail <= 0 {
		tail = 200
	}
	opts := &corev1.PodLogOptions{TailLines: &tail}
	if container != "" {
		opts.Container = container
	}
	return client.CoreV1().Pods(ns).GetLogs(name, opts).Stream(ctx)
}

// ScaleStatefulSet sets replicas; StatefulSets retire the highest ordinal first.
func ScaleStatefulSet(ctx context.Context, client kubernetes.Interface, ns, name string, replicas int) error {
	if replicas < 0 {
		return invalid("replicas must be >= 0")
	}
	patch, _ := json.Marshal(map[string]any{"spec": map[string]any{"replicas": replicas}})
	_, err := client.AppsV1().StatefulSets(ns).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

// DeleteWorkload removes a StatefulSet, DaemonSet or Job with its pods.
func DeleteWorkload(ctx context.Context, client kubernetes.Interface, kind gen.WorkloadKind, ns, name string) error {
	policy := metav1.DeletePropagationBackground
	opts := metav1.DeleteOptions{PropagationPolicy: &policy}
	switch kind {
	case gen.WorkloadKindStatefulSet:
		if err := client.AppsV1().StatefulSets(ns).Delete(ctx, name, opts); err != nil {
			return err
		}
		if svc, err := client.CoreV1().Services(ns).Get(ctx, name, metav1.GetOptions{}); err == nil && svc.Labels[ManagedByLabel] == managedByValue {
			_ = client.CoreV1().Services(ns).Delete(ctx, name, metav1.DeleteOptions{})
		}
		return nil
	case gen.WorkloadKindDaemonSet:
		return client.AppsV1().DaemonSets(ns).Delete(ctx, name, opts)
	case gen.WorkloadKindJob:
		return client.BatchV1().Jobs(ns).Delete(ctx, name, opts)
	default:
		return invalid("unknown workload kind %q", kind)
	}
}

// SetWorkloadMapPos stores a StatefulSet structure's tile; other kinds have no structure.
func SetWorkloadMapPos(ctx context.Context, client kubernetes.Interface, kind gen.WorkloadKind, ns, name string, mp gen.MapPos) error {
	if kind != gen.WorkloadKindStatefulSet {
		return invalid("%s has no structure to place", kind)
	}
	patch := annotationPatch(MapPosAnnotation, FormatMapPos(mp))
	_, err := client.AppsV1().StatefulSets(ns).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

// DeleteIngress closes a gate.
func DeleteIngress(ctx context.Context, client kubernetes.Interface, ns, name string) error {
	return client.NetworkingV1().Ingresses(ns).Delete(ctx, name, metav1.DeleteOptions{})
}

const (
	defaultMountPath = "/data"
	volumeName       = "data"
)

// BuildStatefulSet turns a create request into a StatefulSet and the
// headless Service that governs it.
func BuildStatefulSet(req gen.CreateStatefulSetRequest) (*appsv1.StatefulSet, *corev1.Service, error) {
	if errs := validation.IsDNS1123Label(req.Name); len(errs) > 0 {
		return nil, nil, invalid("name %q: %s", req.Name, strings.Join(errs, "; "))
	}
	if errs := validation.IsDNS1123Label(req.Ns); len(errs) > 0 {
		return nil, nil, invalid("namespace %q: %s", req.Ns, strings.Join(errs, "; "))
	}
	if strings.TrimSpace(req.Image) == "" {
		return nil, nil, invalid("image is required")
	}
	if req.Replicas < 0 {
		return nil, nil, invalid("replicas must be >= 0")
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
		return nil, nil, invalid("cpuRequest %q: %v", cpu, err)
	}
	memQ, err := resource.ParseQuantity(mem)
	if err != nil {
		return nil, nil, invalid("memRequest %q: %v", mem, err)
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
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: req.Name, Namespace: req.Ns, Labels: labels},
		Spec:       corev1.ServiceSpec{ClusterIP: corev1.ClusterIPNone, Selector: map[string]string{"app": req.Name}},
	}
	if req.Port != nil {
		if *req.Port < 1 || *req.Port > 65535 {
			return nil, nil, invalid("port must be 1-65535")
		}
		container.Ports = []corev1.ContainerPort{{ContainerPort: int32(*req.Port), Name: "http"}}
		svc.Spec.Ports = []corev1.ServicePort{{Name: "http", Port: int32(*req.Port), TargetPort: intstr.FromInt32(int32(*req.Port))}}
	}
	var claims []corev1.PersistentVolumeClaim
	if req.Storage != nil && strings.TrimSpace(*req.Storage) != "" {
		size, err := resource.ParseQuantity(strings.TrimSpace(*req.Storage))
		if err != nil {
			return nil, nil, invalid("storage %q: %v", *req.Storage, err)
		}
		mount := defaultMountPath
		if req.MountPath != nil && strings.TrimSpace(*req.MountPath) != "" {
			mount = strings.TrimSpace(*req.MountPath)
		}
		if !strings.HasPrefix(mount, "/") {
			return nil, nil, invalid("mountPath must be absolute")
		}
		claim := corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: volumeName},
			Spec: corev1.PersistentVolumeClaimSpec{
				AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
				Resources:   corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: size}},
			},
		}
		if req.StorageClass != nil && *req.StorageClass != "" {
			claim.Spec.StorageClassName = req.StorageClass
		}
		claims = []corev1.PersistentVolumeClaim{claim}
		container.VolumeMounts = []corev1.VolumeMount{{Name: volumeName, MountPath: mount}}
	}
	replicas := int32(req.Replicas)
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: req.Name, Namespace: req.Ns, Labels: labels, Annotations: annotations},
		Spec: appsv1.StatefulSetSpec{
			Replicas:    &replicas,
			ServiceName: req.Name,
			Selector:    &metav1.LabelSelector{MatchLabels: map[string]string{"app": req.Name}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": req.Name}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{container}},
			},
			VolumeClaimTemplates: claims,
		},
	}
	return ss, svc, nil
}

// CreateStatefulSet builds a tanker terminal: the headless Service first,
// then the StatefulSet. An existing Service with the same name is reused.
func CreateStatefulSet(ctx context.Context, client kubernetes.Interface, req gen.CreateStatefulSetRequest) (*appsv1.StatefulSet, error) {
	ss, svc, err := BuildStatefulSet(req)
	if err != nil {
		return nil, err
	}
	if _, err := client.CoreV1().Services(req.Ns).Create(ctx, svc, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
		return nil, err
	}
	return client.AppsV1().StatefulSets(req.Ns).Create(ctx, ss, metav1.CreateOptions{})
}

// BuildIngress turns a create request into an Ingress manifest.
func BuildIngress(req gen.CreateIngressRequest) (*netv1.Ingress, error) {
	if errs := validation.IsDNS1123Subdomain(req.Name); len(errs) > 0 {
		return nil, invalid("name %q: %s", req.Name, strings.Join(errs, "; "))
	}
	if errs := validation.IsDNS1123Label(req.Ns); len(errs) > 0 {
		return nil, invalid("namespace %q: %s", req.Ns, strings.Join(errs, "; "))
	}
	if strings.TrimSpace(req.Service) == "" {
		return nil, invalid("service (lighthouse) is required")
	}
	port := strings.TrimSpace(req.Port)
	if port == "" {
		return nil, invalid("port is required")
	}
	backend := netv1.IngressServiceBackend{Name: strings.TrimSpace(req.Service)}
	if n, err := strconv.Atoi(port); err == nil {
		if n < 1 || n > 65535 {
			return nil, invalid("port must be 1-65535")
		}
		backend.Port.Number = int32(n)
	} else {
		if errs := validation.IsValidPortName(port); len(errs) > 0 {
			return nil, invalid("port %q: %s", port, strings.Join(errs, "; "))
		}
		backend.Port.Name = port
	}
	host := ""
	if req.Host != nil {
		host = strings.TrimSpace(*req.Host)
	}
	if host != "" {
		if errs := validation.IsDNS1123Subdomain(strings.TrimPrefix(host, "*.")); len(errs) > 0 {
			return nil, invalid("host %q: %s", host, strings.Join(errs, "; "))
		}
	}
	path := "/"
	if req.Path != nil && strings.TrimSpace(*req.Path) != "" {
		path = strings.TrimSpace(*req.Path)
	}
	if !strings.HasPrefix(path, "/") {
		return nil, invalid("path must start with /")
	}
	pt := netv1.PathTypePrefix
	ing := &netv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: req.Name, Namespace: req.Ns, Labels: map[string]string{ManagedByLabel: managedByValue}},
		Spec: netv1.IngressSpec{
			Rules: []netv1.IngressRule{{
				Host: host,
				IngressRuleValue: netv1.IngressRuleValue{HTTP: &netv1.HTTPIngressRuleValue{Paths: []netv1.HTTPIngressPath{{
					Path: path, PathType: &pt, Backend: netv1.IngressBackend{Service: &backend},
				}}}},
			}},
		},
	}
	if req.Class != nil && strings.TrimSpace(*req.Class) != "" {
		c := strings.TrimSpace(*req.Class)
		ing.Spec.IngressClassName = &c
	}
	if req.Tls != nil && *req.Tls {
		tls := netv1.IngressTLS{}
		if host != "" {
			tls.Hosts = []string{host}
		}
		if req.TlsSecret != nil && strings.TrimSpace(*req.TlsSecret) != "" {
			tls.SecretName = strings.TrimSpace(*req.TlsSecret)
		}
		ing.Spec.TLS = []netv1.IngressTLS{tls}
	}
	return ing, nil
}

// CreateIngress opens a gate.
func CreateIngress(ctx context.Context, client kubernetes.Interface, req gen.CreateIngressRequest) (*netv1.Ingress, error) {
	ing, err := BuildIngress(req)
	if err != nil {
		return nil, err
	}
	return client.NetworkingV1().Ingresses(req.Ns).Create(ctx, ing, metav1.CreateOptions{})
}

// BuildJob turns a create request into a Job manifest.
func BuildJob(req gen.CreateJobRequest) (*batchv1.Job, error) {
	if errs := validation.IsDNS1123Label(req.Name); len(errs) > 0 {
		return nil, invalid("name %q: %s", req.Name, strings.Join(errs, "; "))
	}
	if errs := validation.IsDNS1123Label(req.Ns); len(errs) > 0 {
		return nil, invalid("namespace %q: %s", req.Ns, strings.Join(errs, "; "))
	}
	if strings.TrimSpace(req.Image) == "" {
		return nil, invalid("image is required")
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
	completions := int32(1)
	if req.Completions != nil {
		if *req.Completions < 1 {
			return nil, invalid("completions must be >= 1")
		}
		completions = int32(*req.Completions)
	}
	parallelism := int32(1)
	if req.Parallelism != nil {
		if *req.Parallelism < 1 {
			return nil, invalid("parallelism must be >= 1")
		}
		parallelism = int32(*req.Parallelism)
	}
	backoff := int32(3)
	if req.BackoffLimit != nil {
		if *req.BackoffLimit < 0 {
			return nil, invalid("backoffLimit must be >= 0")
		}
		backoff = int32(*req.BackoffLimit)
	}
	policy := corev1.RestartPolicyNever
	if req.RestartPolicy != nil && *req.RestartPolicy == gen.OnFailure {
		policy = corev1.RestartPolicyOnFailure
	}
	container := corev1.Container{
		Name:  req.Name,
		Image: strings.TrimSpace(req.Image),
		Resources: corev1.ResourceRequirements{Requests: corev1.ResourceList{
			corev1.ResourceCPU:    cpuQ,
			corev1.ResourceMemory: memQ,
		}},
	}
	if req.Command != nil && len(*req.Command) > 0 {
		container.Command = *req.Command
	}
	if req.Args != nil && len(*req.Args) > 0 {
		container.Args = *req.Args
	}
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Name: req.Name, Namespace: req.Ns, Labels: map[string]string{"app": req.Name, ManagedByLabel: managedByValue}},
		Spec: batchv1.JobSpec{
			Completions:  &completions,
			Parallelism:  &parallelism,
			BackoffLimit: &backoff,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": req.Name}},
				Spec:       corev1.PodSpec{RestartPolicy: policy, Containers: []corev1.Container{container}},
			},
		},
	}
	if req.TtlSeconds != nil {
		if *req.TtlSeconds < 0 {
			return nil, invalid("ttlSeconds must be >= 0")
		}
		ttl := int32(*req.TtlSeconds)
		job.Spec.TTLSecondsAfterFinished = &ttl
	}
	return job, nil
}

// CreateJob sends a fishing fleet out.
func CreateJob(ctx context.Context, client kubernetes.Interface, req gen.CreateJobRequest) (*batchv1.Job, error) {
	job, err := BuildJob(req)
	if err != nil {
		return nil, err
	}
	return client.BatchV1().Jobs(req.Ns).Create(ctx, job, metav1.CreateOptions{})
}
