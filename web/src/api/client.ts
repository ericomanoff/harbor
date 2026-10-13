import type { components } from './schema';
import { ledger } from '../game/ledger';
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
export type CreateStatefulSetRequest = components['schemas']['CreateStatefulSetRequest'];
export type CreateIngressRequest = components['schemas']['CreateIngressRequest'];
export type CreateServiceRequest = components['schemas']['CreateServiceRequest'];
export type Orders = components['schemas']['Orders'];
export type OrdersRef = components['schemas']['OrdersRef'];
export type CreateOrdersRequest = components['schemas']['CreateOrdersRequest'];
export type RefitRequest = components['schemas']['RefitRequest'];
export type Namespace = components['schemas']['Namespace'];
export type Service = components['schemas']['Service'];
export type CreateJobRequest = components['schemas']['CreateJobRequest'];
export type Workload = components['schemas']['Workload'];
export type Ingress = components['schemas']['Ingress'];

/** An error answer from the backend, with its HTTP status and message. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Open Harbor (?demo) is a built-in cluster: nothing done in it may reach a real one. */
export const inDemoHarbor = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

async function request<T>(method: string, path: string, body?: unknown, fetchFn: typeof fetch = fetch): Promise<T> {
  if (method !== 'GET') ledger.add({ who: 'you', what: `${method} ${path.replace(/\?.*$/, '')}`, dir: 'request' });
  if (training.active || (inDemoHarbor() && !path.startsWith('/api/progress') && !path.startsWith('/api/campaigns') && path !== '/api/healthz')) return simulate(method, path, body) as T;
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

/** Refit a shipyard: a new image and, optionally, how the rollout may proceed. */
export function refitDeployment(ns: string, name: string, req: RefitRequest, fetchFn: typeof fetch = fetch): Promise<void> {
  return request<void>('PATCH', `/api/deployments/${enc(ns)}/${enc(name)}/refit`, req, fetchFn);
}

/** Roll back to the previous refit (rollout undo). */
export function rollbackDeployment(ns: string, name: string, fetchFn: typeof fetch = fetch): Promise<void> {
  return request<void>('POST', `/api/deployments/${enc(ns)}/${enc(name)}/rollback`, undefined, fetchFn);
}

export type StageResult = components['schemas']['StageResult'];
export type ObjectPapers = components['schemas']['ObjectPapers'];
export type ApplyResult = components['schemas']['ApplyResult'];
export type LabelPatch = components['schemas']['LabelPatch'];

/** An object's papers: spec, status, metadata and who wrote it. */
export function getPapers(kind: string, ns: string, name: string, fetchFn: typeof fetch = fetch): Promise<ObjectPapers> {
  return request<ObjectPapers>('GET', `/api/objects/${kind}/${enc(ns || '-')}/${enc(name)}`, undefined, fetchFn);
}

/** Server-side apply of one or more manifests; dryRun reports what would change. */
export function applyManifest(manifest: string, dryRun: boolean, fetchFn: typeof fetch = fetch): Promise<ApplyResult> {
  return request<ApplyResult>('POST', '/api/apply', { manifest, dryRun }, fetchFn);
}

export function patchPodLabels(ns: string, name: string, patch: LabelPatch, fetchFn: typeof fetch = fetch): Promise<void> {
  return request<void>('PATCH', `/api/pods/${enc(ns)}/${enc(name)}/labels`, patch, fetchFn);
}

export function patchDeploymentLabels(ns: string, name: string, patch: LabelPatch, fetchFn: typeof fetch = fetch): Promise<void> {
  return request<void>('PATCH', `/api/deployments/${enc(ns)}/${enc(name)}/labels`, patch, fetchFn);
}
export type Campaign = components['schemas']['Campaign'];
export type CampaignLevel = components['schemas']['CampaignLevel'];
export type CampaignStep = components['schemas']['CampaignStep'];
export type CampaignGoal = components['schemas']['CampaignGoal'];
export type ProbeResult = components['schemas']['ProbeResult'];

/** Expeditions: vendor campaigns as data, and the checks they may run. */
export const campaigns = {
  list: (fetchFn: typeof fetch = fetch): Promise<Campaign[]> => request<Campaign[]>('GET', '/api/campaigns', undefined, fetchFn),
  probe: (probe: string, args: Record<string, string> = {}, fetchFn: typeof fetch = fetch): Promise<ProbeResult> => request<ProbeResult>('POST', '/api/campaigns/probe', { probe, args }, fetchFn),
};

/** Stage a whitelisted academy incident on the connected cluster. */
export function stage(incident: string, args: { ns?: string; name?: string; image?: string } = {}, fetchFn: typeof fetch = fetch): Promise<StageResult> {
  return request<StageResult>('POST', `/api/stage/${incident}`, args, fetchFn);
}

/** Found a fleet: create a Namespace. */
export function createNamespace(name: string, fetchFn: typeof fetch = fetch): Promise<Namespace> {
  return request<Namespace>('POST', '/api/namespaces', { name }, fetchFn);
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

export function deleteIngress(ns: string, name: string, fetchFn: typeof fetch = fetch): Promise<void> {
  return request<void>('DELETE', `/api/ingresses/${enc(ns)}/${enc(name)}`, undefined, fetchFn);
}

export function createStatefulSet(req: CreateStatefulSetRequest, fetchFn: typeof fetch = fetch): Promise<Workload> {
  return request<Workload>('POST', '/api/workloads/statefulsets', req, fetchFn);
}

/** Sealed orders: ConfigMaps and Secrets (keys only ever come back). */
export const orders = {
  list: (ns: string, fetchFn: typeof fetch = fetch): Promise<Orders[]> => request<Orders[]>('GET', `/api/orders?ns=${enc(ns)}`, undefined, fetchFn),
  create: (req: CreateOrdersRequest, fetchFn: typeof fetch = fetch): Promise<Orders> => request<Orders>('POST', '/api/orders', req, fetchFn),
  remove: (kind: 'ConfigMap' | 'Secret', ns: string, name: string, fetchFn: typeof fetch = fetch): Promise<void> => request<void>('DELETE', `/api/orders/${kind}/${enc(ns)}/${enc(name)}`, undefined, fetchFn),
};

export function createService(req: CreateServiceRequest, fetchFn: typeof fetch = fetch): Promise<Service> {
  return request<Service>('POST', '/api/services', req, fetchFn);
}

export function deleteService(ns: string, name: string, fetchFn: typeof fetch = fetch): Promise<void> {
  return request<void>('DELETE', `/api/services/${enc(ns)}/${enc(name)}`, undefined, fetchFn);
}

export function createIngress(req: CreateIngressRequest, fetchFn: typeof fetch = fetch): Promise<Ingress> {
  return request<Ingress>('POST', '/api/ingresses', req, fetchFn);
}

export function createJob(req: CreateJobRequest, fetchFn: typeof fetch = fetch): Promise<Workload> {
  return request<Workload>('POST', '/api/workloads/jobs', req, fetchFn);
}
