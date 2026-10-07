package kube

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

// TestIntegrationKind runs against a real cluster. It is skipped unless
// HARBOR_KIND_TEST=1; HARBOR_KIND_CONTEXT overrides the context (default
// kind-harbor, as created by `make kind-up`).
func TestIntegrationKind(t *testing.T) {
	if os.Getenv("HARBOR_KIND_TEST") != "1" {
		t.Skip("set HARBOR_KIND_TEST=1 to run against the kind cluster")
	}
	ctxName := os.Getenv("HARBOR_KIND_CONTEXT")
	if ctxName == "" {
		ctxName = "kind-harbor"
	}

	client, err := NewClientset(ctxName)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := Ping(ctx, client); err != nil {
		t.Fatalf("ping %s: %v", ctxName, err)
	}

	hub := NewHub()
	w := NewWatcher(ctxName, client, hub)
	if err := w.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer w.Stop()

	snap := w.Snapshot()
	if len(snap.Nodes) == 0 || len(snap.Namespaces) == 0 {
		t.Fatalf("snapshot looks empty: %d nodes, %d namespaces", len(snap.Nodes), len(snap.Namespaces))
	}
	t.Logf("%s: %d nodes, %d namespaces, %d deployments, %d pods",
		ctxName, len(snap.Nodes), len(snap.Namespaces), len(snap.Deployments), len(snap.Pods))

	// The sample workloads from deploy/kind should be present and resolved.
	for _, p := range snap.Pods {
		if p.Ns == "sandbox" && p.Deployment == nil {
			t.Errorf("pod %s/%s has no resolved deployment", p.Ns, p.Name)
		}
	}
	for _, n := range snap.Nodes {
		if n.CpuAlloc == 0 {
			t.Errorf("node %s has zero allocatable CPU", n.Name)
		}
	}

	// Pods in a live cluster update status frequently enough that the hub
	// should see something within the window.
	ch, unsub := hub.Subscribe(256)
	defer unsub()
	select {
	case m := <-ch:
		if !m.Kind.Valid() || !m.Type.Valid() {
			t.Errorf("bad message %+v", m)
		}
		if m.Type == gen.WsMessageTypeSnapshot {
			t.Error("watcher should not publish snapshots")
		}
	case <-time.After(45 * time.Second):
		t.Log("no live change observed in 45s; scale something to exercise the stream")
	}
}
