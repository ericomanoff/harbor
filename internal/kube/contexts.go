// Package kube talks to Kubernetes: kubeconfig contexts, informer-backed
// watching, and conversion of API objects into the lean wire models the
// frontend renders.
package kube

import (
	"fmt"
	"sort"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

// loadingRules follows kubectl: $KUBECONFIG (possibly a list) or ~/.kube/config.
// Built per call so tests can point KUBECONFIG at a temp file.
func loadingRules() *clientcmd.ClientConfigLoadingRules {
	return clientcmd.NewDefaultClientConfigLoadingRules()
}

// ListContexts returns every kubeconfig context sorted by name, plus the
// kubeconfig's current-context name.
func ListContexts() ([]gen.KubeContext, string, error) {
	raw, err := loadingRules().Load()
	if err != nil {
		return nil, "", fmt.Errorf("load kubeconfig: %w", err)
	}
	out := make([]gen.KubeContext, 0, len(raw.Contexts))
	for name, c := range raw.Contexts {
		kc := gen.KubeContext{Name: name, Cluster: c.Cluster, User: c.AuthInfo}
		if c.Namespace != "" {
			ns := c.Namespace
			kc.Namespace = &ns
		}
		out = append(out, kc)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, raw.CurrentContext, nil
}

// RestConfig builds a client config for the named context. An empty name
// means the kubeconfig's current context.
func RestConfig(contextName string) (*rest.Config, error) {
	cfg := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		loadingRules(),
		&clientcmd.ConfigOverrides{CurrentContext: contextName},
	)
	rc, err := cfg.ClientConfig()
	if err != nil {
		return nil, err
	}
	// Informers for six kinds plus user actions; the defaults (5/10) throttle
	// the initial list on anything but a toy cluster.
	rc.QPS = 50
	rc.Burst = 100
	return rc, nil
}

// NewClientset returns a typed clientset for the named context.
func NewClientset(contextName string) (kubernetes.Interface, error) {
	rc, err := RestConfig(contextName)
	if err != nil {
		return nil, err
	}
	return kubernetes.NewForConfig(rc)
}
