package kube

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
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
	out := gen.Pod{
		Ns:       p.Namespace,
		Name:     p.Name,
		Node:     p.Spec.NodeName,
		Phase:    phase,
		Ready:    ready,
		Restarts: restarts,
		Created:  p.CreationTimestamp.Time,
		Reason:   optString(reason),
		OwnerRS:  optString(OwnerOfKind(p.OwnerReferences, "ReplicaSet")),
	}
	out.Deployment = optString(deployment)
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
