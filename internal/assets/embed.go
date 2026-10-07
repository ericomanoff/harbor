// Package assets embeds the built Phaser frontend so the harbor binary is
// self-contained. `make web` writes the Vite build into ./dist.
package assets

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed all:dist
var dist embed.FS

// Handler serves the built frontend. If no build is present it serves a short
// page explaining how to produce one, so `go run` always shows something.
func Handler() http.Handler {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(placeholder))
		})
	}
	return http.FileServerFS(sub)
}

const placeholder = `<!doctype html>
<meta charset="utf-8">
<title>harbor</title>
<body style="background:#000;color:#39ff14;font-family:monospace;padding:2em">
<h1>harbor</h1>
<p>No frontend build is embedded. Run <code>make web</code> then rebuild, or use
<code>make dev</code> for the Vite dev server.</p>
</body>`
