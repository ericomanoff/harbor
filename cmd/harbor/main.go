// Command harbor serves the Command & Conquer style Kubernetes GUI.
//
// It binds to loopback only: the process runs as the local user with their own
// kubeconfig, so exposing it on a network interface would hand that access to
// anyone who can reach the port.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/ericomanoff/harbor/internal/api"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "listen address (keep this on loopback)")
	flag.Parse()

	srv := &http.Server{
		Addr:              *addr,
		Handler:           api.NewHandler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("harbor listening on http://%s", *addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
