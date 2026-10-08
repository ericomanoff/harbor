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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harbor</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(180deg,#5fbde6,#3a98c9);font-family:Nunito,'Segoe UI',system-ui,sans-serif">
<div style="width:380px;padding:22px 26px;background:#f6efdc;color:#2d3319;border:2px solid #4b5a2a;border-radius:14px;box-shadow:0 6px 0 rgba(0,0,0,.18),0 12px 28px rgba(0,0,0,.3);text-align:center">
<div style="font-size:44px">⚓</div>
<div style="font-size:36px;font-weight:900">Harbor</div>
<p style="font-weight:700;color:#6b7350;margin:8px 0 14px">No charts aboard: this binary has no frontend build embedded.</p>
<p style="font-weight:600;font-size:13px;margin:0">Run <code>make web</code> and rebuild, or <code>make dev</code> for the Vite dev server.</p>
</div>
</body>`
