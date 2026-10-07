package api

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/ericomanoff/harbor/internal/api/gen"
	"github.com/ericomanoff/harbor/internal/kube"
)

const (
	wsBuffer       = 512
	wsWriteTimeout = 5 * time.Second
)

// handleWS streams cluster changes. On connect the client receives one
// snapshot message, then a modified/added/deleted message per change. A new
// snapshot message means the backend switched context; the client must
// replace its whole state.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// The server only binds loopback; these keep a page on another origin
		// from opening the stream through the browser.
		OriginPatterns: []string{"localhost:*", "127.0.0.1:*", "[::1]:*"},
	})
	if err != nil {
		log.Printf("ws: accept: %v", err)
		return
	}
	defer c.CloseNow()

	// CloseRead discards client frames and cancels ctx when the peer goes away.
	ctx := c.CloseRead(r.Context())

	ch, cancel := s.hub.Subscribe(wsBuffer)
	defer cancel()

	if err := s.send(ctx, c, kube.NewMessage(gen.WsMessageTypeSnapshot, s.snapshot())); err != nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-ch:
			if err := s.send(ctx, c, m); err != nil {
				return
			}
		}
	}
}

func (s *Server) send(ctx context.Context, c *websocket.Conn, m gen.WsMessage) error {
	wctx, cancel := context.WithTimeout(ctx, wsWriteTimeout)
	defer cancel()
	return wsjson.Write(wctx, c, m)
}
