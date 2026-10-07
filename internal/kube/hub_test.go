package kube

import (
	"encoding/json"
	"testing"

	"github.com/ericomanoff/harbor/internal/api/gen"
)

func TestHubFanOutAndDrop(t *testing.T) {
	h := NewHub()
	a, cancelA := h.Subscribe(1)
	b, cancelB := h.Subscribe(1)
	defer cancelA()
	defer cancelB()

	msg := NewMessage(gen.WsMessageTypeModified, gen.Namespace{Name: "x", Phase: "Active"})
	h.Publish(msg)
	h.Publish(msg) // second one overflows both buffers

	if h.Dropped() != 2 || h.Subscribers() != 2 {
		t.Errorf("dropped = %d subscribers = %d", h.Dropped(), h.Subscribers())
	}
	for _, ch := range []<-chan gen.WsMessage{a, b} {
		got := <-ch
		if got.Kind != gen.WsMessageKindNamespace || got.Type != gen.WsMessageTypeModified {
			t.Errorf("got %+v", got)
		}
	}
	cancelA()
	if h.Subscribers() != 1 {
		t.Errorf("subscribers after cancel = %d", h.Subscribers())
	}
}

func TestNewMessageEncodesObject(t *testing.T) {
	m := NewMessage(gen.WsMessageTypeDeleted, gen.Pod{Ns: "default", Name: "p", Phase: "Deleted"})
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	var back struct {
		Type string `json:"type"`
		Kind string `json:"kind"`
		Obj  struct {
			Name  string `json:"name"`
			Phase string `json:"phase"`
		} `json:"obj"`
	}
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	if back.Type != "deleted" || back.Kind != "Pod" || back.Obj.Name != "p" || back.Obj.Phase != "Deleted" {
		t.Errorf("wire form: %s", raw)
	}
}

func TestNewMessagePanicsOnUnknownType(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("expected panic")
		}
	}()
	NewMessage(gen.WsMessageTypeAdded, "not a wire model")
}
