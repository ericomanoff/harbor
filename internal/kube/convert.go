package kube

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	netv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

// MapPosAnnotation stores where the player placed a Deployment on the map.
const MapPosAnnotation = "harbor.dev/map-pos"

// revisionAnnotation is set by the deployment controller on both the
// Deployment and each of its ReplicaSets.
const revisionAnnotation = "deployment.kubernetes.io/revision"

// Helm stamps every resource it manages with the owning release.
const helmReleaseAnnotation = "meta.helm.sh/release-name"

// HelmSecretSelector matches Helm's release storage secrets.
const HelmSecretSelector = "owner=helm"

// ConvertHelmSecret reads the release summary Helm keeps in the labels of a
// storage secret (sh.helm.release.v1.<name>.v<revision>). The payload is
// not decoded; chart details come from the Helm SDK on demand.
func ConvertHelmSecret(s *corev1.Secret) (gen.HelmRelease, bool) {
	name := s.Labels["name"]
	if s.Labels["owner"] != "helm" || name == "" {
		return gen.HelmRelease{}, false
	}
	rev, err := strconv.Atoi(s.Labels["version"])
	if err != nil {
		return gen.HelmRelease{}, false
	}
	out := gen.HelmRelease{Ns: s.Namespace, Name: name, Revision: rev, Status: s.Labels["status"]}
	if ts, err := strconv.ParseInt(s.Labels["modifiedAt"], 10, 64); err == nil {
		t := time.Unix(ts, 0).UTC()
		out.Updated = &t
	}
	return out, true
}

// CurrentReplicaSet returns the name of the ReplicaSet that matches the
// Deployment's current revision, or the highest-revision one it owns, or "".
func CurrentReplicaSet(d *appsv1.Deployment, sets []*appsv1.ReplicaSet) string {
	want := d.Annotations[revisionAnnotation]
	best := ""
	bestRev := -1
	for _, rs := range sets {
		if rs.Namespace != d.Namespace || OwnerOfKind(rs.OwnerReferences, "Deployment") != d.Name {
			continue
		}
		rev := rs.Annotations[revisionAnnotation]
		if want != "" && rev == want {
			return rs.Name
		}
		if n, err := strconv.Atoi(rev); err == nil && n > bestRev {
			best, bestRev = rs.Name, n
		}
	}
	return best
}

// ParseMapPos decodes "x,y". Anything else returns ok=false.
func ParseMapPos(s string) (gen.MapPos, bool) {
	x, y, ok := strings.Cut(strings.TrimSpace(s), ",")
	if !ok {
		return gen.MapPos{}, false
	}
	xi, errX := strconv.Atoi(strings.TrimSpace(x))
	yi, errY := strconv.Atoi(strings.TrimSpace(y))
	if errX != nil || errY != nil {
		return gen.MapPos{}, false
	}
	return gen.MapPos{X: xi, Y: yi}, true
}

// FormatMapPos is the inverse of ParseMapPos.
func FormatMapPos(mp gen.MapPos) string {
	return fmt.Sprintf("%d,%d", mp.X, mp.Y)
}

// ConvertNode summarises a node. pods are the pods scheduled on it, used to
// sum resource requests (the "power drain" on the map).
func ConvertNode(n *corev1.Node, pods []*corev1.Pod) gen.Node {
	ready := false
	for _, c := range n.Status.Conditions {
		if c.Type == corev1.NodeReady {
			ready = c.Status == corev1.ConditionTrue
		}
	}
	var cpuReq, memReq int64
	for _, p := range pods {
		if p.Status.Phase == corev1.PodSucceeded || p.Status.Phase == corev1.PodFailed {
			continue
		}
		cpu, mem := podRequests(p)
		cpuReq += cpu
		memReq += mem
	}
	labels := n.Labels
	if labels == nil {
		labels = map[string]string{}
	}
	return gen.Node{
		Name:     n.Name,
		Ready:    ready,
		CpuAlloc: int(n.Status.Allocatable.Cpu().MilliValue()),
		MemAlloc: n.Status.Allocatable.Memory().Value(),
		CpuReq:   int(cpuReq),
		MemReq:   memReq,
		Labels:   labels,
	}
}

// podRequests follows the scheduler: max(sum of containers, each init container).
func podRequests(p *corev1.Pod) (cpuMilli, memBytes int64) {
	for _, c := range p.Spec.Containers {
		cpuMilli += c.Resources.Requests.Cpu().MilliValue()
		memBytes += c.Resources.Requests.Memory().Value()
	}
	for _, c := range p.Spec.InitContainers {
		cpuMilli = max(cpuMilli, c.Resources.Requests.Cpu().MilliValue())
		memBytes = max(memBytes, c.Resources.Requests.Memory().Value())
	}
	return cpuMilli, memBytes
}

// ConvertService summarises a Service; its selector is what links it to units.
func ConvertService(svc *corev1.Service) gen.Service {
	ports := make([]gen.ServicePort, 0, len(svc.Spec.Ports))
	for _, p := range svc.Spec.Ports {
		ports = append(ports, gen.ServicePort{
			Port:       int(p.Port),
			TargetPort: p.TargetPort.String(),
			Protocol:   string(p.Protocol),
			Name:       optString(p.Name),
		})
	}
	selector := svc.Spec.Selector
	if selector == nil {
		selector = map[string]string{}
	}
	return gen.Service{
		Ns:        svc.Namespace,
		Name:      svc.Name,
		Type:      string(svc.Spec.Type),
		ClusterIP: svc.Spec.ClusterIP,
		Ports:     ports,
		Selector:  selector,
	}
}

// strategySummary: "RollingUpdate maxUnavailable=25% maxSurge=25%" or "Recreate".
func strategySummary(st appsv1.DeploymentStrategy) string {
	if st.Type == appsv1.RecreateDeploymentStrategyType {
		return "Recreate"
	}
	mu, ms := "25%", "25%"
	if st.RollingUpdate != nil {
		if st.RollingUpdate.MaxUnavailable != nil {
			mu = st.RollingUpdate.MaxUnavailable.String()
		}
		if st.RollingUpdate.MaxSurge != nil {
			ms = st.RollingUpdate.MaxSurge.String()
		}
	}
	return "RollingUpdate maxUnavailable=" + mu + " maxSurge=" + ms
}

// resourceSummary: "cpu 50m · mem 64Mi" (only what is set).
func resourceSummary(rl corev1.ResourceList) string {
	parts := []string{}
	if q, ok := rl[corev1.ResourceCPU]; ok {
		parts = append(parts, "cpu "+q.String())
	}
	if q, ok := rl[corev1.ResourceMemory]; ok {
		parts = append(parts, "mem "+q.String())
	}
	return strings.Join(parts, " · ")
}

// ordersOf lists the ConfigMaps and Secrets a pod template reads, as "Kind/name".
func ordersOf(spec *corev1.PodSpec) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(kind, name string) {
		if name == "" {
			return
		}
		k := kind + "/" + name
		if !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	for _, c := range spec.Containers {
		for _, e := range c.EnvFrom {
			if e.ConfigMapRef != nil {
				add("ConfigMap", e.ConfigMapRef.Name)
			}
			if e.SecretRef != nil {
				add("Secret", e.SecretRef.Name)
			}
		}
		for _, e := range c.Env {
			if e.ValueFrom == nil {
				continue
			}
			if e.ValueFrom.ConfigMapKeyRef != nil {
				add("ConfigMap", e.ValueFrom.ConfigMapKeyRef.Name)
			}
			if e.ValueFrom.SecretKeyRef != nil {
				add("Secret", e.ValueFrom.SecretKeyRef.Name)
			}
		}
	}
	for _, v := range spec.Volumes {
		if v.ConfigMap != nil {
			add("ConfigMap", v.ConfigMap.Name)
		}
		if v.Secret != nil {
			add("Secret", v.Secret.SecretName)
		}
	}
	return out
}

// probeSummary describes a probe in a few words: "http /healthz", "tcp 5432", "exec".
func probeSummary(p *corev1.Probe) string {
	switch {
	case p == nil:
		return ""
	case p.HTTPGet != nil:
		return "http " + p.HTTPGet.Path
	case p.TCPSocket != nil:
		return "tcp " + p.TCPSocket.Port.String()
	case p.GRPC != nil:
		return "grpc"
	case p.Exec != nil:
		return "exec"
	}
	return "probe"
}

// ConvertIngress: the harbor mouth. Rules are flattened to host/path/service.
func ConvertIngress(ing *netv1.Ingress) gen.Ingress {
	out := gen.Ingress{Ns: ing.Namespace, Name: ing.Name, Hosts: []string{}, Rules: []gen.IngressRule{}, Addresses: []string{}, Tls: len(ing.Spec.TLS) > 0}
	out.Class = optString(derefStr(ing.Spec.IngressClassName))
	seenHost := map[string]bool{}
	addRule := func(host string, p netv1.HTTPIngressPath) {
		r := gen.IngressRule{Host: host, Path: p.Path}
		if p.Backend.Service != nil {
			r.Service = p.Backend.Service.Name
			if p.Backend.Service.Port.Name != "" {
				r.Port = p.Backend.Service.Port.Name
			} else if p.Backend.Service.Port.Number != 0 {
				r.Port = strconv.Itoa(int(p.Backend.Service.Port.Number))
			}
		}
		out.Rules = append(out.Rules, r)
	}
	for _, rule := range ing.Spec.Rules {
		if rule.Host != "" && !seenHost[rule.Host] {
			seenHost[rule.Host] = true
			out.Hosts = append(out.Hosts, rule.Host)
		}
		if rule.HTTP == nil {
			continue
		}
		for _, p := range rule.HTTP.Paths {
			addRule(rule.Host, p)
		}
	}
	if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
		addRule("", netv1.HTTPIngressPath{Path: "/*", Backend: *ing.Spec.DefaultBackend})
	}
	for _, lb := range ing.Status.LoadBalancer.Ingress {
		if lb.IP != "" {
			out.Addresses = append(out.Addresses, lb.IP)
		} else if lb.Hostname != "" {
			out.Addresses = append(out.Addresses, lb.Hostname)
		}
	}
	return out
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func ConvertNamespace(ns *corev1.Namespace) gen.Namespace {
	return gen.Namespace{Name: ns.Name, Phase: string(ns.Status.Phase)}
}

func ConvertDeployment(d *appsv1.Deployment) gen.Deployment {
	replicas := 1
	if d.Spec.Replicas != nil {
		replicas = int(*d.Spec.Replicas)
	}
	image := ""
	if cs := d.Spec.Template.Spec.Containers; len(cs) > 0 {
		image = cs[0].Image
	}
	conds := make([]gen.Condition, 0, len(d.Status.Conditions))
	for _, c := range d.Status.Conditions {
		conds = append(conds, gen.Condition{
			Type:    string(c.Type),
			Status:  string(c.Status),
			Reason:  optString(c.Reason),
			Message: optString(c.Message),
		})
	}
	out := gen.Deployment{
		Ns:         d.Namespace,
		Name:       d.Name,
		Replicas:   replicas,
		Available:  int(d.Status.AvailableReplicas),
		Updated:    int(d.Status.UpdatedReplicas),
		Image:      image,
		Conditions: conds,
	}
	if mp, ok := ParseMapPos(d.Annotations[MapPosAnnotation]); ok {
		out.MapPos = &mp
	}
	out.Release = optString(d.Annotations[helmReleaseAnnotation])
	if cs := d.Spec.Template.Spec.Containers; len(cs) > 0 {
		out.Readiness = optString(probeSummary(cs[0].ReadinessProbe))
		out.Liveness = optString(probeSummary(cs[0].LivenessProbe))
		out.Requests = optString(resourceSummary(cs[0].Resources.Requests))
		out.Limits = optString(resourceSummary(cs[0].Resources.Limits))
	}
	if o := ordersOf(&d.Spec.Template.Spec); len(o) > 0 {
		out.Orders = &o
	}
	out.Strategy = optString(strategySummary(d.Spec.Strategy))
	if rev, err := strconv.Atoi(d.Annotations[revisionAnnotation]); err == nil {
		out.Revision = &rev
	}
	return out
}

// firstImage returns the first container image of a pod template.
func firstImage(spec corev1.PodSpec) string {
	if len(spec.Containers) > 0 {
		return spec.Containers[0].Image
	}
	return ""
}

func convertConditions[T any](items []T, get func(T) (string, string, string, string)) []gen.Condition {
	out := make([]gen.Condition, 0, len(items))
	for _, it := range items {
		typ, status, reason, msg := get(it)
		out = append(out, gen.Condition{Type: typ, Status: status, Reason: optString(reason), Message: optString(msg)})
	}
	return out
}

// ConvertStatefulSet: a tanker terminal.
func ConvertStatefulSet(ss *appsv1.StatefulSet) gen.Workload {
	desired := 1
	if ss.Spec.Replicas != nil {
		desired = int(*ss.Spec.Replicas)
	}
	out := gen.Workload{
		Kind: gen.WorkloadKindStatefulSet, Ns: ss.Namespace, Name: ss.Name,
		Image: firstImage(ss.Spec.Template.Spec), Desired: desired, Ready: int(ss.Status.ReadyReplicas),
		Conditions: convertConditions(ss.Status.Conditions, func(c appsv1.StatefulSetCondition) (string, string, string, string) {
			return string(c.Type), string(c.Status), c.Reason, c.Message
		}),
	}
	if mp, ok := ParseMapPos(ss.Annotations[MapPosAnnotation]); ok {
		out.MapPos = &mp
	}
	out.Release = optString(ss.Annotations[helmReleaseAnnotation])
	return out
}

// ConvertDaemonSet: a tug company, one tug per dock.
func ConvertDaemonSet(ds *appsv1.DaemonSet) gen.Workload {
	out := gen.Workload{
		Kind: gen.WorkloadKindDaemonSet, Ns: ds.Namespace, Name: ds.Name,
		Image: firstImage(ds.Spec.Template.Spec), Desired: int(ds.Status.DesiredNumberScheduled), Ready: int(ds.Status.NumberReady),
		Conditions: convertConditions(ds.Status.Conditions, func(c appsv1.DaemonSetCondition) (string, string, string, string) {
			return string(c.Type), string(c.Status), c.Reason, c.Message
		}),
	}
	out.Release = optString(ds.Annotations[helmReleaseAnnotation])
	return out
}

// ConvertJob: a fishing fleet that comes home when the catch is landed.
func ConvertJob(j *batchv1.Job) gen.Workload {
	desired := 1
	if j.Spec.Completions != nil {
		desired = int(*j.Spec.Completions)
	} else if j.Spec.Parallelism != nil {
		desired = int(*j.Spec.Parallelism)
	}
	active := int(j.Status.Active)
	failed := int(j.Status.Failed)
	complete := false
	for _, c := range j.Status.Conditions {
		if (c.Type == batchv1.JobComplete || c.Type == batchv1.JobFailed) && c.Status == corev1.ConditionTrue {
			complete = true
		}
	}
	out := gen.Workload{
		Kind: gen.WorkloadKindJob, Ns: j.Namespace, Name: j.Name,
		Image: firstImage(j.Spec.Template.Spec), Desired: desired, Ready: int(j.Status.Succeeded),
		Active: &active, Failed: &failed, Complete: &complete,
		Conditions: convertConditions(j.Status.Conditions, func(c batchv1.JobCondition) (string, string, string, string) {
			return string(c.Type), string(c.Status), c.Reason, c.Message
		}),
	}
	out.Release = optString(j.Annotations[helmReleaseAnnotation])
	return out
}

// ConvertPod summarises a pod. deployment is the owning Deployment name if
// the caller could resolve it through the ReplicaSet, else "".
func ConvertPod(p *corev1.Pod, deployment string) gen.Pod {
	phase := string(p.Status.Phase)
	if p.DeletionTimestamp != nil {
		phase = "Terminating"
	}
	ready := false
	for _, c := range p.Status.Conditions {
		if c.Type == corev1.PodReady {
			ready = c.Status == corev1.ConditionTrue
		}
	}
	restarts := 0
	reason := ""
	for _, cs := range p.Status.ContainerStatuses {
		restarts += int(cs.RestartCount)
		switch {
		case cs.State.Waiting != nil && cs.State.Waiting.Reason != "":
			reason = worseReason(reason, cs.State.Waiting.Reason)
		case cs.State.Terminated != nil && cs.State.Terminated.Reason != "" && !cs.Ready:
			reason = worseReason(reason, cs.State.Terminated.Reason)
		}
	}
	if reason == "" && p.Status.Reason != "" { // e.g. Evicted
		reason = p.Status.Reason
	}
	labels := p.Labels
	if labels == nil {
		labels = map[string]string{}
	}
	containers := make([]string, 0, len(p.Spec.Containers))
	for _, c := range p.Spec.Containers {
		containers = append(containers, c.Name)
	}
	out := gen.Pod{
		Ns:         p.Namespace,
		Name:       p.Name,
		Node:       p.Spec.NodeName,
		Phase:      phase,
		Ready:      ready,
		Restarts:   restarts,
		Created:    p.CreationTimestamp.Time,
		Labels:     labels,
		Containers: containers,
		Reason:     optString(reason),
		OwnerRS:    optString(OwnerOfKind(p.OwnerReferences, "ReplicaSet")),
	}
	out.Deployment = optString(deployment)
	// Direct controller, with ReplicaSets collapsed to their Deployment.
	if deployment != "" {
		out.OwnerKind, out.OwnerName = optString("Deployment"), optString(deployment)
	} else if c := metav1.GetControllerOf(p); c != nil {
		out.OwnerKind, out.OwnerName = optString(c.Kind), optString(c.Name)
	}
	return out
}

// worseReason keeps the more alarming of two container reasons so a pod
// with one crashing container shows as crashing.
func worseReason(cur, next string) string {
	if cur == "" {
		return next
	}
	if next == "CrashLoopBackOff" || next == "OOMKilled" {
		return next
	}
	return cur
}

// OwnerOfKind returns the name of the first owner reference of the given kind.
func OwnerOfKind(refs []metav1.OwnerReference, kind string) string {
	for _, r := range refs {
		if r.Kind == kind {
			return r.Name
		}
	}
	return ""
}

// EventTime picks the most meaningful timestamp an Event carries.
func EventTime(e *corev1.Event) time.Time {
	switch {
	case !e.LastTimestamp.IsZero():
		return e.LastTimestamp.Time
	case !e.EventTime.IsZero():
		return e.EventTime.Time
	default:
		return e.CreationTimestamp.Time
	}
}

func ConvertEvent(e *corev1.Event) gen.Event {
	return gen.Event{
		Ns:      e.Namespace,
		Kind:    e.InvolvedObject.Kind,
		Name:    e.InvolvedObject.Name,
		Type:    e.Type,
		Reason:  e.Reason,
		Message: e.Message,
		Ts:      EventTime(e),
	}
}

func optString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
