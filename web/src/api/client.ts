import type { components } from './schema';

export type Health = components['schemas']['Health'];

/** Fetches liveness from the Go backend. Throws on non-2xx. */
export async function getHealth(fetchFn: typeof fetch = fetch): Promise<Health> {
  const res = await fetchFn('/api/healthz');
  if (!res.ok) throw new Error(`healthz: HTTP ${res.status}`);
  return (await res.json()) as Health;
}

/** Formats a health response as the one-line status shown on the boot screen. */
export function formatHealth(h: Health): string {
  return `BACKEND ONLINE  v${h.version}  UP ${h.uptimeSeconds}s`;
}
