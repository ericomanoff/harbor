import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the built game against the Go binary and a real
 * cluster (the kind cluster from `make kind-up`). Run with `make test-e2e`.
 */
const PORT = 8098;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 960, height: 600 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `../bin/harbor -addr 127.0.0.1:${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
