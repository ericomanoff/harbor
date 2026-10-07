import type { components } from './schema';

export type Health = components['schemas']['Health'];
export type CreateDeploymentRequest = components['schemas']['CreateDeploymentRequest'];
export type Deployment = components['schemas']['Deployment'];
export type MapPos = components['schemas']['MapPos'];

/** An error answer from the backend, with its HTTP status and message. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, fetchFn: typeof fetch = fetch): Promise<T> {
  const res = await fetchFn(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { message?: string };
      if (err.message) msg = err.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetches liveness from the Go backend. Throws on non-2xx. */
export function getHealth(fetchFn: typeof fetch = fetch): Promise<Health> {
  return request<Health>('GET', '/api/healthz', undefined, fetchFn);
}

/** Formats a health response as the one-line status shown on the boot screen. */
export function formatHealth(h: Health): string {
  return `BACKEND ONLINE  v${h.version}  UP ${h.uptimeSeconds}s`;
}

export function createDeployment(req: CreateDeploymentRequest, fetchFn: typeof fetch = fetch): Promise<Deployment> {
  return request<Deployment>('POST', '/api/deployments', req, fetchFn);
}

export function scaleDeployment(ns: string, name: string, replicas: number, retireFirst?: string[], fetchFn: typeof fetch = fetch): Promise<void> {
  const body = retireFirst?.length ? { replicas, retireFirst } : { replicas };
  return request<void>('PATCH', `/api/deployments/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/scale`, body, fetchFn);
}

export function setMapPos(ns: string, name: string, mp: MapPos, fetchFn: typeof fetch = fetch): Promise<void> {
  return request<void>('PATCH', `/api/deployments/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/mappos`, mp, fetchFn);
}

export function deleteDeployment(ns: string, name: string, fetchFn: typeof fetch = fetch): Promise<void> {
  return request<void>('DELETE', `/api/deployments/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`, undefined, fetchFn);
}

export function deletePod(ns: string, name: string, fetchFn: typeof fetch = fetch): Promise<void> {
  return request<void>('DELETE', `/api/pods/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`, undefined, fetchFn);
}
