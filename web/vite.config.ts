import { defineConfig } from 'vitest/config';

const backend = 'http://127.0.0.1:8080';

export default defineConfig({
  build: {
    // The Go binary embeds this directory via internal/assets/embed.go.
    outDir: '../internal/assets/dist',
    emptyOutDir: true,
    // Phaser alone is ~1.2 MB minified; it is served from loopback so size is fine.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/ws': { target: backend.replace('http', 'ws'), ws: true },
    },
  },
  test: {
    environment: 'node',
  },
});
