package kube

import (
	"context"
	"encoding/json"
	"os"
	"strings"
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
	// (Other tests leave terminating pods behind in sandbox; ignore those.)
	for _, p := range snap.Pods {
		if p.Ns == "sandbox" && (strings.HasPrefix(p.Name, "nginx-") || strings.HasPrefix(p.Name, "crashy-")) && p.Deployment == nil {
			t.Errorf("pod %s/%s has no resolved deployment", p.Ns, p.Name)
		}
	}
	for _, n := range snap.Nodes {
		if n.CpuAlloc == 0 {
			t.Errorf("node %s has zero allocatable CPU", n.Name)
		}
	}

	// Write path round trip: create, wait for the stream to show it ready,
	// scale, move, delete. Cleaned up even on failure.
	ch, unsub := hub.Subscribe(1024)
	defer unsub()
	name := "harbor-it"
	ns := "sandbox"
	_ = DeleteDeployment(ctx, client, ns, name) // leftover from a failed run
	t.Cleanup(func() { _ = DeleteDeployment(context.Background(), client, ns, name) })

	if _, err := CreateDeployment(ctx, client, gen.CreateDeploymentRequest{
		Ns: ns, Name: name, Image: "nginx:1.27-alpine", Replicas: 2, MapPos: &gen.MapPos{X: 5, Y: 2},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	waitFor(t, ch, 90*time.Second, "deployment available", func(m gen.WsMessage) bool {
		if m.Kind != gen.WsMessageKindDeployment {
			return false
		}
		var d gen.Deployment
		_ = json.Unmarshal(mustRaw(t, m), &d)
		return d.Name == name && d.Available == 2 && d.MapPos != nil && d.MapPos.X == 5
	})

	if err := ScaleDeployment(ctx, client, ns, name, 3, nil); err != nil {
		t.Fatalf("scale: %v", err)
	}
	waitFor(t, ch, 90*time.Second, "third unit ready", func(m gen.WsMessage) bool {
		if m.Kind != gen.WsMessageKindDeployment {
			return false
		}
		var d gen.Deployment
		_ = json.Unmarshal(mustRaw(t, m), &d)
		return d.Name == name && d.Available == 3
	})

	// Sell a specific unit: it, and only it, must be the one that goes.
	var victim string
	for _, p := range w.Snapshot().Pods {
		if p.Ns == ns && p.Deployment != nil && *p.Deployment == name {
			victim = p.Name
			break
		}
	}
	if victim == "" {
		t.Fatal("no pod found to sell")
	}
	if err := ScaleDeployment(ctx, client, ns, name, 2, []string{victim}); err != nil {
		t.Fatalf("sell: %v", err)
	}
	waitFor(t, ch, 60*time.Second, "victim deleted", func(m gen.WsMessage) bool {
		if m.Kind != gen.WsMessageKindPod || m.Type != gen.WsMessageTypeDeleted {
			return false
		}
		var p gen.Pod
		_ = json.Unmarshal(mustRaw(t, m), &p)
		return p.Name == victim
	})

	if err := SetMapPos(ctx, client, ns, name, gen.MapPos{X: 8, Y: 2}); err != nil {
		t.Fatalf("mappos: %v", err)
	}
	if err := DeleteDeployment(ctx, client, ns, name); err != nil {
		t.Fatalf("delete: %v", err)
	}
	waitFor(t, ch, 60*time.Second, "deployment deleted", func(m gen.WsMessage) bool {
		return m.Kind == gen.WsMessageKindDeployment && m.Type == gen.WsMessageTypeDeleted
	})
}

// waitFor drains the hub until pred matches or the timeout passes.
func waitFor(t *testing.T, ch <-chan gen.WsMessage, d time.Duration, what string, pred func(gen.WsMessage) bool) {
	t.Helper()
	deadline := time.After(d)
	for {
		select {
		case m := <-ch:
			if pred(m) {
				return
			}
		case <-deadline:
			t.Fatalf("timed out waiting for %s", what)
		}
	}
}
