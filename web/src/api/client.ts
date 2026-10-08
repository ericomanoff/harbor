import type { components } from './schema';
import { simulate, training } from '../tour/training';

export type Health = components['schemas']['Health'];
export type CreateDeploymentRequest = components['schemas']['CreateDeploymentRequest'];
export type Deployment = components['schemas']['Deployment'];
export type MapPos = components['schemas']['MapPos'];
export type HelmRepo = components['schemas']['HelmRepo'];
export type HelmChart = components['schemas']['HelmChart'];
export type HelmValues = components['schemas']['HelmValues'];
export type HelmRelease = components['schemas']['HelmRelease'];
export type HelmRevision = components['schemas']['HelmRevision'];
export type HelmInstallRequest = components['schemas']['HelmInstallRequest'];
export type HelmUpgradeRequest = components['schemas']['HelmUpgradeRequest'];
export type ContextList = components['schemas']['ContextList'];

/** An error answer from the backend, with its HTTP status and message. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, fetchFn: typeof fetch = fetch): Promise<T> {
  if (training.active) return simulate(method, path, body) as T;
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

const enc = encodeURIComponent;

export const helm = {
  listRepos: (f: typeof fetch = fetch) => request<HelmRepo[]>('GET', '/api/helm/repos', undefined, f),
  addRepo: (repo: HelmRepo, f: typeof fetch = fetch) => request<void>('POST', '/api/helm/repos', repo, f),
  updateRepos: (f: typeof fetch = fetch) => request<void>('POST', '/api/helm/repos/update', undefined, f),
  searchCharts: (q: string, f: typeof fetch = fetch) => request<HelmChart[]>('GET', `/api/helm/charts?q=${enc(q)}`, undefined, f),
  chartValues: (chart: string, version?: string, f: typeof fetch = fetch) =>
    request<HelmValues>('GET', `/api/helm/charts/values?chart=${enc(chart)}${version ? `&version=${enc(version)}` : ''}`, undefined, f),
  listReleases: (f: typeof fetch = fetch) => request<HelmRelease[]>('GET', '/api/helm/releases', undefined, f),
  install: (req: HelmInstallRequest, f: typeof fetch = fetch) => request<HelmRelease>('POST', '/api/helm/releases', req, f),
  upgrade: (ns: string, name: string, req: HelmUpgradeRequest, f: typeof fetch = fetch) =>
    request<HelmRelease>('POST', `/api/helm/releases/${enc(ns)}/${enc(name)}/upgrade`, req, f),
  rollback: (ns: string, name: string, revision: number, f: typeof fetch = fetch) =>
    request<void>('POST', `/api/helm/releases/${enc(ns)}/${enc(name)}/rollback`, { revision }, f),
  uninstall: (ns: string, name: string, f: typeof fetch = fetch) => request<void>('DELETE', `/api/helm/releases/${enc(ns)}/${enc(name)}`, undefined, f),
  history: (ns: string, name: string, f: typeof fetch = fetch) => request<HelmRevision[]>('GET', `/api/helm/releases/${enc(ns)}/${enc(name)}/history`, undefined, f),
};

export async function getPodLogs(ns: string, name: string, tail = 200, container?: string, fetchFn: typeof fetch = fetch): Promise<string> {
  if (training.active) return simulate('GET', `/api/pods/${enc(ns)}/${enc(name)}/logs`, undefined) as string;
  const res = await fetchFn(`/api/pods/${enc(ns)}/${enc(name)}/logs?tail=${tail}${container ? `&container=${enc(container)}` : ''}`);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { message?: string };
      if (err.message) msg = err.message;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res.text();
}

export const contexts = {
  list: (f: typeof fetch = fetch) => request<ContextList>('GET', '/api/contexts', undefined, f),
  select: (name: string, f: typeof fetch = fetch) => request<void>('POST', `/api/contexts/${enc(name)}/select`, undefined, f),
};

export type WorkloadKind = 'StatefulSet' | 'DaemonSet' | 'Job';

export const workloads = {
  scale: (kind: WorkloadKind, ns: string, name: string, replicas: number, f: typeof fetch = fetch) =>
    request<void>('PATCH', `/api/workloads/${kind}/${enc(ns)}/${enc(name)}/scale`, { replicas }, f),
  remove: (kind: WorkloadKind, ns: string, name: string, f: typeof fetch = fetch) =>
    request<void>('DELETE', `/api/workloads/${kind}/${enc(ns)}/${enc(name)}`, undefined, f),
  setMapPos: (kind: WorkloadKind, ns: string, name: string, mp: MapPos, f: typeof fetch = fetch) =>
    request<void>('PATCH', `/api/workloads/${kind}/${enc(ns)}/${enc(name)}/mappos`, mp, f),
};
