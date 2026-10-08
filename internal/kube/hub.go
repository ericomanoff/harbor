package kube

import (
	"log"
	"sync"
	"sync/atomic"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

// Hub fans WsMessages out to every subscribed WebSocket connection.
// Publish never blocks: a subscriber whose buffer is full loses the message
// and is expected to resynchronise by requesting a fresh snapshot.
type Hub struct {
	mu      sync.RWMutex
	subs    map[*subscriber]struct{}
	dropped atomic.Int64
}

type subscriber struct {
	ch chan gen.WsMessage
}

func NewHub() *Hub {
	return &Hub{subs: map[*subscriber]struct{}{}}
}

// Subscribe registers a receiver with the given buffer size. The returned
// cancel func removes it; the channel is never closed, so readers must also
// select on their own context.
func (h *Hub) Subscribe(buffer int) (<-chan gen.WsMessage, func()) {
	s := &subscriber{ch: make(chan gen.WsMessage, buffer)}
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
	return s.ch, func() {
		h.mu.Lock()
		delete(h.subs, s)
		h.mu.Unlock()
	}
}

// Publish delivers msg to every subscriber without blocking.
func (h *Hub) Publish(msg gen.WsMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.subs {
		select {
		case s.ch <- msg:
		default:
			if h.dropped.Add(1)%100 == 1 {
				log.Printf("hub: slow subscriber, dropping messages (total dropped %d)", h.dropped.Load())
			}
		}
	}
}

// Subscribers returns the current subscriber count.
func (h *Hub) Subscribers() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs)
}

// Dropped returns how many messages were dropped for slow subscribers.
func (h *Hub) Dropped() int64 { return h.dropped.Load() }

// NewMessage wraps a wire model in a WsMessage. v must be one of the wire
// model types; anything else panics, because that is a programming error.
func NewMessage(t gen.WsMessageType, v any) gen.WsMessage {
	var obj gen.WsMessage_Obj
	var kind gen.WsMessageKind
	var err error
	switch x := v.(type) {
	case gen.Node:
		kind, err = gen.WsMessageKindNode, obj.FromNode(x)
	case gen.Namespace:
		kind, err = gen.WsMessageKindNamespace, obj.FromNamespace(x)
	case gen.Deployment:
		kind, err = gen.WsMessageKindDeployment, obj.FromDeployment(x)
	case gen.Pod:
		kind, err = gen.WsMessageKindPod, obj.FromPod(x)
	case gen.Workload:
		kind, err = gen.WsMessageKindWorkload, obj.FromWorkload(x)
	case gen.Service:
		kind, err = gen.WsMessageKindService, obj.FromService(x)
	case gen.Ingress:
		kind, err = gen.WsMessageKindIngress, obj.FromIngress(x)
	case gen.Event:
		kind, err = gen.WsMessageKindEvent, obj.FromEvent(x)
	case gen.HelmRelease:
		kind, err = gen.WsMessageKindHelmRelease, obj.FromHelmRelease(x)
	case gen.Snapshot:
		kind, err = gen.WsMessageKindSnapshot, obj.FromSnapshot(x)
	default:
		panic("kube.NewMessage: unsupported wire type")
	}
	if err != nil {
		panic("kube.NewMessage: " + err.Error())
	}
	return gen.WsMessage{Type: t, Kind: kind, Obj: &obj}
}
