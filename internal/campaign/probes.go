package campaign

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

// The probe whitelist: every check a campaign may ask the harbor to run.
var probes = map[string]func(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string){
	"kube-version":       probeKubeVersion,
	"node-arch":          probeNodeArch,
	"node-label":         probeNodeLabel,
	"ingress-controller": probeIngressController,
	"storage-class":      probeStorageClass,
	"secret-exists":      probeSecret,
	"configmap-exists":   probeConfigMap,
	"release-deployed":   probeReleaseDeployed,
	"release-revision":   probeReleaseRevision,
	"pvc-bound":          probePVCBound,
	"pods-ready":         probePodsReady,
	"ingress-address":    probeIngressAddress,
	"http":               probeHTTP,
}

// KnownProbe reports whether a campaign may use the probe.
func KnownProbe(name string) bool {
	_, ok := probes[name]
	return ok
}

// Run executes one whitelisted probe. The result is never an error for a
// failed check; errors are for unknown probes and cluster trouble.
func Run(ctx context.Context, client kubernetes.Interface, req gen.ProbeRequest) (gen.ProbeResult, error) {
	fn, ok := probes[req.Probe]
	if !ok {
		return gen.ProbeResult{}, fmt.Errorf("unknown probe %q", req.Probe)
	}
	args := map[string]string{}
	if req.Args != nil {
		args = *req.Args
	}
	ok, msg := fn(ctx, client, args)
	return gen.ProbeResult{Ok: ok, Message: msg}, nil
}

func probeKubeVersion(_ context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	v, err := client.Discovery().ServerVersion()
	if err != nil {
		return false, "could not read the server version: " + err.Error()
	}
	got := strings.TrimPrefix(v.GitVersion, "v")
	min := args["min"]
	if min == "" {
		return true, "Kubernetes " + got
	}
	if versionLess(got, min) {
		return false, fmt.Sprintf("Kubernetes %s is older than %s", got, min)
	}
	return true, fmt.Sprintf("Kubernetes %s (need %s or newer)", got, min)
}

// versionLess compares dotted numeric prefixes ("1.31.2" < "1.25" is false).
func versionLess(a, b string) bool {
	pa := strings.Split(strings.SplitN(a, "-", 2)[0], ".")
	pb := strings.Split(strings.SplitN(b, "-", 2)[0], ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		x, y := 0, 0
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x < y
		}
	}
	return false
}

func probeNodeArch(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	nodes, err := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return false, err.Error()
	}
	want := args["arch"]
	if want == "" {
		want = "linux/amd64"
	}
	var have []string
	n := 0
	for _, nd := range nodes.Items {
		a := nd.Status.NodeInfo.OperatingSystem + "/" + nd.Status.NodeInfo.Architecture
		have = append(have, nd.Name+" "+a)
		if a == want {
			n++
		}
	}
	if n == 0 {
		return false, fmt.Sprintf("no %s node: %s", want, strings.Join(have, ", "))
	}
	return true, fmt.Sprintf("%d of %d nodes are %s", n, len(nodes.Items), want)
}

func probeNodeLabel(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	label := args["label"]
	if label == "" {
		return false, "node-label needs label=key or key=value"
	}
	nodes, err := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{LabelSelector: label})
	if err != nil {
		return false, err.Error()
	}
	if len(nodes.Items) == 0 {
		return false, "no node carries " + label
	}
	names := make([]string, 0, len(nodes.Items))
	for _, nd := range nodes.Items {
		names = append(names, nd.Name)
	}
	return true, fmt.Sprintf("%s on %s", label, strings.Join(names, ", "))
}

func probeIngressController(ctx context.Context, client kubernetes.Interface, _ map[string]string) (bool, string) {
	classes, err := client.NetworkingV1().IngressClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return false, err.Error()
	}
	if len(classes.Items) == 0 {
		return false, "no IngressClass: install an ingress controller (nginx, traefik, …)"
	}
	names := make([]string, 0, len(classes.Items))
	for _, c := range classes.Items {
		names = append(names, c.Name+" ("+c.Spec.Controller+")")
	}
	return true, "ingress classes: " + strings.Join(names, ", ")
}

func probeStorageClass(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	scs, err := client.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return false, err.Error()
	}
	if len(scs.Items) == 0 {
		return false, "no StorageClass on this cluster"
	}
	if name := args["name"]; name != "" {
		for _, sc := range scs.Items {
			if sc.Name == name {
				return true, fmt.Sprintf("StorageClass %s (%s)", sc.Name, sc.Provisioner)
			}
		}
		return false, "StorageClass " + name + " not found"
	}
	names := make([]string, 0, len(scs.Items))
	for _, sc := range scs.Items {
		names = append(names, sc.Name+" ("+sc.Provisioner+")")
	}
	note := ""
	if args["access"] == "rwx" {
		note = "; check that the provisioner supports ReadWriteMany"
	}
	return true, "storage classes: " + strings.Join(names, ", ") + note
}

func probeSecret(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	if _, err := client.CoreV1().Secrets(args["ns"]).Get(ctx, args["name"], metav1.GetOptions{}); err != nil {
		return false, fmt.Sprintf("secret %s/%s: %v", args["ns"], args["name"], err)
	}
	return true, fmt.Sprintf("secret %s/%s is sealed", args["ns"], args["name"])
}

func probeConfigMap(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	if _, err := client.CoreV1().ConfigMaps(args["ns"]).Get(ctx, args["name"], metav1.GetOptions{}); err != nil {
		return false, fmt.Sprintf("configmap %s/%s: %v", args["ns"], args["name"], err)
	}
	return true, fmt.Sprintf("configmap %s/%s is in the locker", args["ns"], args["name"])
}

// Helm keeps one Secret per release revision, labelled owner=helm.
func releaseSecrets(ctx context.Context, client kubernetes.Interface, ns, name string) ([]corev1.Secret, error) {
	list, err := client.CoreV1().Secrets(ns).List(ctx, metav1.ListOptions{LabelSelector: "owner=helm,name=" + name})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func probeReleaseDeployed(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	secs, err := releaseSecrets(ctx, client, args["ns"], args["name"])
	if err != nil {
		return false, err.Error()
	}
	for _, s := range secs {
		if s.Labels["status"] == "deployed" {
			return true, fmt.Sprintf("release %s/%s is deployed (revision %s)", args["ns"], args["name"], s.Labels["version"])
		}
	}
	return false, fmt.Sprintf("release %s/%s is not deployed", args["ns"], args["name"])
}

func probeReleaseRevision(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	secs, err := releaseSecrets(ctx, client, args["ns"], args["name"])
	if err != nil {
		return false, err.Error()
	}
	max := 0
	for _, s := range secs {
		if v, err := strconv.Atoi(s.Labels["version"]); err == nil && v > max {
			max = v
		}
	}
	min, _ := strconv.Atoi(args["min"])
	if max < min {
		return false, fmt.Sprintf("release %s/%s is at revision %d, need %d", args["ns"], args["name"], max, min)
	}
	return true, fmt.Sprintf("release %s/%s is at revision %d", args["ns"], args["name"], max)
}

func probePVCBound(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	pvcs, err := client.CoreV1().PersistentVolumeClaims(args["ns"]).List(ctx, metav1.ListOptions{})
	if err != nil {
		return false, err.Error()
	}
	if len(pvcs.Items) == 0 {
		return false, "no PersistentVolumeClaim in " + args["ns"]
	}
	var pending []string
	for _, p := range pvcs.Items {
		if p.Status.Phase != corev1.ClaimBound {
			pending = append(pending, p.Name+" "+string(p.Status.Phase))
		}
	}
	if len(pending) > 0 {
		return false, "not bound: " + strings.Join(pending, ", ")
	}
	return true, fmt.Sprintf("%d claim(s) bound in %s", len(pvcs.Items), args["ns"])
}

func probePodsReady(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	pods, err := client.CoreV1().Pods(args["ns"]).List(ctx, metav1.ListOptions{LabelSelector: args["selector"]})
	if err != nil {
		return false, err.Error()
	}
	if len(pods.Items) == 0 {
		return false, "no pods in " + args["ns"]
	}
	var notReady []string
	for _, p := range pods.Items {
		ready := false
		for _, c := range p.Status.Conditions {
			if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
				ready = true
			}
		}
		if !ready && p.Status.Phase != corev1.PodSucceeded {
			notReady = append(notReady, p.Name)
		}
	}
	sort.Strings(notReady)
	if len(notReady) > 0 {
		return false, "not ready: " + strings.Join(notReady, ", ")
	}
	return true, fmt.Sprintf("%d pod(s) ready in %s", len(pods.Items), args["ns"])
}

func probeIngressAddress(ctx context.Context, client kubernetes.Interface, args map[string]string) (bool, string) {
	ing, err := client.NetworkingV1().Ingresses(args["ns"]).Get(ctx, args["name"], metav1.GetOptions{})
	if err != nil {
		return false, err.Error()
	}
	var addrs []string
	for _, lb := range ing.Status.LoadBalancer.Ingress {
		if lb.IP != "" {
			addrs = append(addrs, lb.IP)
		}
		if lb.Hostname != "" {
			addrs = append(addrs, lb.Hostname)
		}
	}
	if len(addrs) == 0 {
		return false, fmt.Sprintf("ingress %s/%s has no address yet (is a controller claiming it?)", args["ns"], args["name"])
	}
	return true, "reachable at " + strings.Join(addrs, ", ")
}

func probeHTTP(ctx context.Context, _ kubernetes.Interface, args map[string]string) (bool, string) {
	url := args["url"]
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return false, "http needs url=https://…"
	}
	// Vendor appliances answer with self-signed certificates on day one.
	client := &http.Client{Timeout: 8 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}} //nolint:gosec
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, err.Error()
	}
	res, err := client.Do(req)
	if err != nil {
		return false, err.Error()
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return false, fmt.Sprintf("%s answered %s", url, res.Status)
	}
	return true, fmt.Sprintf("%s answered %s", url, res.Status)
}
