package kube

import (
	"context"
	"sort"
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
	// The ensign: extra template labels (app stays the selector).
	podLabels := map[string]string{"app": req.Name}
	if req.Labels != nil {
		for k, v := range *req.Labels {
			if k == "app" {
				continue
			}
			if errs := validateLabel(k, v); errs != "" {
				return nil, invalid("label %s=%s: %s", k, v, errs)
			}
			podLabels[k] = v
		}
	}
	var grace *int64
	if req.TerminationGracePeriodSeconds != nil {
		if *req.TerminationGracePeriodSeconds < 0 {
			return nil, invalid("terminationGracePeriodSeconds must be >= 0")
		}
		g := int64(*req.TerminationGracePeriodSeconds)
		grace = &g
	}
	container := corev1.Container{
		Name:  req.Name,
		Image: strings.TrimSpace(req.Image),
		Resources: corev1.ResourceRequirements{Requests: corev1.ResourceList{
			corev1.ResourceCPU:    cpuQ,
			corev1.ResourceMemory: memQ,
		}},
	}
	// Cargo limits: optional caps enforced at runtime.
	if l := derefStr(req.CpuLimit); l != "" {
		q, err := resource.ParseQuantity(l)
		if err != nil {
			return nil, invalid("cpuLimit %q: %v", l, err)
		}
		if q.Cmp(cpuQ) < 0 {
			return nil, invalid("cpuLimit %s is below the request %s", l, cpu)
		}
		container.Resources.Limits = corev1.ResourceList{corev1.ResourceCPU: q}
	}
	if l := derefStr(req.MemLimit); l != "" {
		q, err := resource.ParseQuantity(l)
		if err != nil {
			return nil, invalid("memLimit %q: %v", l, err)
		}
		if q.Cmp(memQ) < 0 {
			return nil, invalid("memLimit %s is below the request %s", l, mem)
		}
		if container.Resources.Limits == nil {
			container.Resources.Limits = corev1.ResourceList{}
		}
		container.Resources.Limits[corev1.ResourceMemory] = q
	}
	// Sealed orders: ConfigMaps and Secrets injected as environment.
	if req.Orders != nil {
		for _, o := range *req.Orders {
			if errs := validation.IsDNS1123Subdomain(o.Name); len(errs) > 0 {
				return nil, invalid("orders %q: %s", o.Name, strings.Join(errs, "; "))
			}
			switch o.Kind {
			case gen.OrdersKindConfigMap:
				container.EnvFrom = append(container.EnvFrom, corev1.EnvFromSource{ConfigMapRef: &corev1.ConfigMapEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: o.Name}}})
			case gen.OrdersKindSecret:
				container.EnvFrom = append(container.EnvFrom, corev1.EnvFromSource{SecretRef: &corev1.SecretEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: o.Name}}})
			default:
				return nil, invalid("orders kind %q: ConfigMap or Secret", o.Kind)
			}
		}
	}
	if req.Port != nil {
		if *req.Port < 1 || *req.Port > 65535 {
			return nil, invalid("port must be 1-65535")
		}
		container.Ports = []corev1.ContainerPort{{ContainerPort: int32(*req.Port), Name: "http"}}
	}
	// Lookouts: HTTP probes on the container port.
	if p := derefStr(req.ReadinessPath); p != "" {
		if req.Port == nil {
			return nil, invalid("readinessPath needs a port")
		}
		container.ReadinessProbe = httpProbe(p, *req.Port, 5)
	}
	if p := derefStr(req.LivenessPath); p != "" {
		if req.Port == nil {
			return nil, invalid("livenessPath needs a port")
		}
		container.LivenessProbe = httpProbe(p, *req.Port, 10)
	}
	replicas := int32(req.Replicas)
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: req.Name, Namespace: req.Ns, Labels: labels, Annotations: annotations},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": req.Name}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: podLabels},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{container}, TerminationGracePeriodSeconds: grace},
			},
		},
	}, nil
}

func httpProbe(path string, port int, period int32) *corev1.Probe {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return &corev1.Probe{
		ProbeHandler:        corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: path, Port: intstr.FromInt(port)}},
		PeriodSeconds:       period,
		InitialDelaySeconds: 2,
		FailureThreshold:    3,
	}
}

// BuildService turns a create request into a Service: a lighthouse whose
// selector picks the ships it guides.
func BuildService(req gen.CreateServiceRequest) (*corev1.Service, error) {
	if errs := validation.IsDNS1123Label(req.Name); len(errs) > 0 {
		return nil, invalid("name %q: %s", req.Name, strings.Join(errs, "; "))
	}
	if errs := validation.IsDNS1123Label(req.Ns); len(errs) > 0 {
		return nil, invalid("namespace %q: %s", req.Ns, strings.Join(errs, "; "))
	}
	if len(req.Selector) == 0 {
		return nil, invalid("selector needs at least one label")
	}
	if req.Port < 1 || req.Port > 65535 {
		return nil, invalid("port must be 1-65535")
	}
	target := req.Port
	if req.TargetPort != nil {
		if *req.TargetPort < 1 || *req.TargetPort > 65535 {
			return nil, invalid("targetPort must be 1-65535")
		}
		target = *req.TargetPort
	}
	typ := corev1.ServiceTypeClusterIP
	switch derefStr(req.Type) {
	case "", "ClusterIP":
	case "NodePort":
		typ = corev1.ServiceTypeNodePort
	case "LoadBalancer":
		typ = corev1.ServiceTypeLoadBalancer
	default:
		return nil, invalid("type must be ClusterIP, NodePort or LoadBalancer")
	}
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: req.Name, Namespace: req.Ns, Labels: map[string]string{ManagedByLabel: managedByValue}},
		Spec: corev1.ServiceSpec{
			Type:     typ,
			Selector: req.Selector,
			Ports:    []corev1.ServicePort{{Name: "http", Port: int32(req.Port), TargetPort: intstr.FromInt(target), Protocol: corev1.ProtocolTCP}},
		},
	}, nil
}

// BuildOrders turns a create request into a ConfigMap or a Secret.
func BuildOrders(req gen.CreateOrdersRequest) (*corev1.ConfigMap, *corev1.Secret, error) {
	if errs := validation.IsDNS1123Subdomain(req.Name); len(errs) > 0 {
		return nil, nil, invalid("name %q: %s", req.Name, strings.Join(errs, "; "))
	}
	if errs := validation.IsDNS1123Label(req.Ns); len(errs) > 0 {
		return nil, nil, invalid("namespace %q: %s", req.Ns, strings.Join(errs, "; "))
	}
	if len(req.Data) == 0 {
		return nil, nil, invalid("orders need at least one key")
	}
	for k := range req.Data {
		if errs := validation.IsConfigMapKey(k); len(errs) > 0 {
			return nil, nil, invalid("key %q: %s", k, strings.Join(errs, "; "))
		}
	}
	meta := metav1.ObjectMeta{Name: req.Name, Namespace: req.Ns, Labels: map[string]string{ManagedByLabel: managedByValue}}
	switch req.Kind {
	case gen.OrdersKindConfigMap:
		return &corev1.ConfigMap{ObjectMeta: meta, Data: req.Data}, nil, nil
	case gen.OrdersKindSecret:
		return nil, &corev1.Secret{ObjectMeta: meta, Type: corev1.SecretTypeOpaque, StringData: req.Data}, nil
	}
	return nil, nil, invalid("kind %q: ConfigMap or Secret", req.Kind)
}

// CreateOrders writes a ConfigMap or Secret and answers with its keys only.
func CreateOrders(ctx context.Context, client kubernetes.Interface, req gen.CreateOrdersRequest) (gen.Orders, error) {
	cm, sec, err := BuildOrders(req)
	if err != nil {
		return gen.Orders{}, err
	}
	if cm != nil {
		out, err := client.CoreV1().ConfigMaps(req.Ns).Create(ctx, cm, metav1.CreateOptions{})
		if err != nil {
			return gen.Orders{}, err
		}
		return ordersOfConfigMap(out), nil
	}
	out, err := client.CoreV1().Secrets(req.Ns).Create(ctx, sec, metav1.CreateOptions{})
	if err != nil {
		return gen.Orders{}, err
	}
	return ordersOfSecret(out), nil
}

// ListOrders lists the ConfigMaps and Secrets of a namespace, keys only.
// Service-account tokens and Helm release records are plumbing, not orders.
func ListOrders(ctx context.Context, client kubernetes.Interface, ns string) ([]gen.Orders, error) {
	out := []gen.Orders{}
	cms, err := client.CoreV1().ConfigMaps(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for i := range cms.Items {
		if cms.Items[i].Name == "kube-root-ca.crt" {
			continue
		}
		out = append(out, ordersOfConfigMap(&cms.Items[i]))
	}
	secs, err := client.CoreV1().Secrets(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for i := range secs.Items {
		if secs.Items[i].Type != corev1.SecretTypeOpaque {
			continue
		}
		out = append(out, ordersOfSecret(&secs.Items[i]))
	}
	return out, nil
}

// DeleteOrders removes a ConfigMap or Secret.
func DeleteOrders(ctx context.Context, client kubernetes.Interface, kind gen.OrdersKind, ns, name string) error {
	switch kind {
	case gen.OrdersKindConfigMap:
		return client.CoreV1().ConfigMaps(ns).Delete(ctx, name, metav1.DeleteOptions{})
	case gen.OrdersKindSecret:
		return client.CoreV1().Secrets(ns).Delete(ctx, name, metav1.DeleteOptions{})
	}
	return invalid("kind %q: ConfigMap or Secret", kind)
}

func ordersOfConfigMap(cm *corev1.ConfigMap) gen.Orders {
	keys := make([]string, 0, len(cm.Data))
	for k := range cm.Data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return gen.Orders{Ns: cm.Namespace, Name: cm.Name, Kind: gen.OrdersKindConfigMap, Keys: keys}
}

func ordersOfSecret(sec *corev1.Secret) gen.Orders {
	keys := make([]string, 0, len(sec.Data)+len(sec.StringData))
	for k := range sec.Data {
		keys = append(keys, k)
	}
	for k := range sec.StringData {
		if _, dup := sec.Data[k]; !dup {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return gen.Orders{Ns: sec.Namespace, Name: sec.Name, Kind: gen.OrdersKindSecret, Keys: keys}
}

// CreateService lights a lighthouse.
func CreateService(ctx context.Context, client kubernetes.Interface, req gen.CreateServiceRequest) (*corev1.Service, error) {
	svc, err := BuildService(req)
	if err != nil {
		return nil, err
	}
	return client.CoreV1().Services(req.Ns).Create(ctx, svc, metav1.CreateOptions{})
}

// DeleteService puts a lighthouse out.
func DeleteService(ctx context.Context, client kubernetes.Interface, ns, name string) error {
	return client.CoreV1().Services(ns).Delete(ctx, name, metav1.DeleteOptions{})
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

// RefitDeployment starts a rollout: a new image for the first container and,
// when given, a RollingUpdate strategy with maxUnavailable/maxSurge.
func RefitDeployment(ctx context.Context, client kubernetes.Interface, ns, name string, req gen.RefitRequest) error {
	image := strings.TrimSpace(req.Image)
	if image == "" {
		return invalid("image is required")
	}
	d, err := client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return err
	}
	if len(d.Spec.Template.Spec.Containers) == 0 {
		return invalid("deployment has no containers")
	}
	spec := map[string]any{
		"template": map[string]any{"spec": map[string]any{"containers": []map[string]any{{"name": d.Spec.Template.Spec.Containers[0].Name, "image": image}}}},
	}
	if derefStr(req.MaxUnavailable) != "" || derefStr(req.MaxSurge) != "" {
		ru := map[string]any{}
		if v := derefStr(req.MaxUnavailable); v != "" {
			if _, err := parseIntOrPercent(v); err != nil {
				return invalid("maxUnavailable %q: %v", v, err)
			}
			ru["maxUnavailable"] = intstr.Parse(v)
		}
		if v := derefStr(req.MaxSurge); v != "" {
			if _, err := parseIntOrPercent(v); err != nil {
				return invalid("maxSurge %q: %v", v, err)
			}
			ru["maxSurge"] = intstr.Parse(v)
		}
		spec["strategy"] = map[string]any{"type": "RollingUpdate", "rollingUpdate": ru}
	}
	patch, _ := json.Marshal(map[string]any{"spec": spec})
	_, err = client.AppsV1().Deployments(ns).Patch(ctx, name, types.StrategicMergePatchType, patch, metav1.PatchOptions{})
	return err
}

func parseIntOrPercent(v string) (intstr.IntOrString, error) {
	x := intstr.Parse(v)
	if x.Type == intstr.String {
		if !strings.HasSuffix(v, "%") {
			return x, fmt.Errorf("want a count or a percent")
		}
		if _, err := strconv.Atoi(strings.TrimSuffix(v, "%")); err != nil {
			return x, err
		}
	}
	return x, nil
}

// RollbackDeployment is `kubectl rollout undo`: the pod template of the
// ReplicaSet one revision back becomes the deployment's template again.
func RollbackDeployment(ctx context.Context, client kubernetes.Interface, ns, name string) error {
	d, err := client.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return err
	}
	sel, err := metav1.LabelSelectorAsSelector(d.Spec.Selector)
	if err != nil {
		return err
	}
	rsl, err := client.AppsV1().ReplicaSets(ns).List(ctx, metav1.ListOptions{LabelSelector: sel.String()})
	if err != nil {
		return err
	}
	cur := int64(-1)
	if v, err := strconv.ParseInt(d.Annotations[revisionAnnotation], 10, 64); err == nil {
		cur = v
	}
	var prev *appsv1.ReplicaSet
	prevRev := int64(-1)
	for i := range rsl.Items {
		rs := &rsl.Items[i]
		if !metav1.IsControlledBy(rs, d) {
			continue
		}
		rev, err := strconv.ParseInt(rs.Annotations[revisionAnnotation], 10, 64)
		if err != nil || (cur >= 0 && rev >= cur) {
			continue
		}
		if rev > prevRev {
			prevRev, prev = rev, rs
		}
	}
	if prev == nil {
		return invalid("no previous refit to roll back to")
	}
	tmpl := prev.Spec.Template.DeepCopy()
	delete(tmpl.Labels, "pod-template-hash")
	patch, _ := json.Marshal(map[string]any{"spec": map[string]any{"template": tmpl}})
	_, err = client.AppsV1().Deployments(ns).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

// CreateNamespace founds a fleet.
func CreateNamespace(ctx context.Context, client kubernetes.Interface, name string) (*corev1.Namespace, error) {
	if errs := validation.IsDNS1123Label(name); len(errs) > 0 {
		return nil, invalid("name %q: %s", name, strings.Join(errs, "; "))
	}
	return client.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name, Labels: map[string]string{ManagedByLabel: managedByValue}}}, metav1.CreateOptions{})
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
