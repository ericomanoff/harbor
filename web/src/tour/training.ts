import { eva, link, source, store } from '../app';
import { demoSnapshot } from '../demo/demo';
import { connectWebSocket } from '../store/source';
import { startDemo } from '../demo/demo';
import { loadAll } from 'js-yaml';
import { ledger } from '../game/ledger';
import { nsKey, type Deployment, type Pod, type Snapshot, type Workload } from '../store/cluster';
import { simulatedPapers, simulatedSpecYaml } from './papers';

/**
 * Training harbor: the tour runs on demo data, and every API call the HUD
 * would make is answered here instead of by the backend, so a learner can
 * build, launch, scrap and sell without touching a real cluster.
 */
export const training = { active: false };

/** Sealed orders the training harbor holds, by "ns/name"; keys only, like the backend. */
export const trainingOrders = new Map<string, { ns: string; name: string; kind: 'ConfigMap' | 'Secret'; keys: string[] }>();

/** Refit history per shipyard ("ns/name"): earlier images, oldest first. Levels may seed it. */
export const trainingHistory = new Map<string, { image: string; rs?: string }[]>();

let liveWasDemo = false;

/**
 * Enters the training harbor with the demo harbor, or with a level's own
 * fixture. Calling it while already training swaps the harbor in place.
 */
export function enterTraining(snapshot: Snapshot = demoSnapshot()): void {
  if (!training.active) {
    liveWasDemo = new URLSearchParams(location.search).has('demo');
    source.stop?.();
    source.stop = undefined;
    training.active = true;
  }
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  trainingOrders.clear();
  trainingHistory.clear();
  controllers.paused = false;
  store.replace(snapshot);
  link.set('demo');
}

export function leaveTraining(): void {
  if (!training.active) return;
  training.active = false;
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  source.stop = liveWasDemo ? startDemo(store) : connectWebSocket(store);
}

const timers: ReturnType<typeof setTimeout>[] = [];
const later = (ms: number, fn: () => void): void => {
  timers.push(setTimeout(fn, ms));
};

const podOf = (ns: string, name: string, deployment: string, nodeName: string, phase: 'Pending' | 'Running', ownerRS?: string): Pod => ({
  ns, name, node: nodeName, phase, ready: phase === 'Running', restarts: 0, created: new Date().toISOString(), deployment,
  labels: { app: deployment }, containers: [deployment], ...(ownerRS ? { ownerRS } : {}),
});

const nodes = (): string[] => [...store.nodes.values()].filter((n) => n.ready).map((n) => n.name);

/** The simulator's controllers can be paused (a lost watch): nothing reconciles until they are resumed. */
export const controllers = { paused: false };

/** Runs fn with the ledger attributing the stream changes to `who` (the simulator's controllers and kubelets). */
export function as(who: string, fn: () => void): void {
  const prev = ledger.actor;
  ledger.actor = who;
  try {
    fn();
  } finally {
    ledger.actor = prev;
  }
}
let seq = 0;

function launch(dep: Deployment, count: number, onReady?: (name: string) => void, delay = 0): void {
  for (let i = 0; i < count; i++) {
    const name = `${dep.name}-trn-${(++seq).toString(36)}`;
    const cur0 = store.deployments.get(nsKey(dep.ns, dep.name));
    const rs = cur0?.currentRS;
    const extra = cur0?.templateLabels ?? {};
    const withLabels = (p: Pod): Pod => ({ ...p, labels: { ...p.labels, ...extra } });
    later(delay, () => as('the Deployment controller', () => store.apply({ type: 'modified', kind: 'Pod', obj: withLabels(podOf(dep.ns, name, dep.name, '', 'Pending', rs)) })));
    later(delay + 700 + i * 400, () => {
      const ns = nodes();
      const node = ns[seq % Math.max(1, ns.length)] ?? '';
      as('the scheduler', () => store.apply({ type: 'modified', kind: 'Pod', obj: withLabels(podOf(dep.ns, name, dep.name, node, 'Pending', rs)) }));
    });
    later(delay + 1200 + i * 400, () => {
      const p = store.pods.get(nsKey(dep.ns, name));
      const node = p?.node || nodes()[0] || '';
      as('the kubelet', () => store.apply({ type: 'modified', kind: 'Pod', obj: withLabels(podOf(dep.ns, name, dep.name, node, 'Running', rs)) }));
      const cur = store.deployments.get(nsKey(dep.ns, dep.name));
      if (cur) as('the Deployment controller', () => store.apply({ type: 'modified', kind: 'Deployment', obj: { ...cur, available: Math.min(cur.replicas, cur.available + 1), updated: Math.min(cur.replicas, cur.updated + 1) } }));
      onReady?.(name);
    });
  }
}

/**
 * A rollout: ships of the old refit are replaced by ships of the new one.
 * With maxUnavailable 0 a new ship moors before an old one is scrapped;
 * otherwise an old ship goes first and the fleet dips meanwhile.
 */
function roll(key: string, newImage: string, strategy: string, safe: boolean): void {
  const dep = store.deployments.get(key);
  if (!dep) return;
  const rs = `${dep.name}-${(++seq).toString(36)}`;
  store.apply({ type: 'modified', kind: 'Deployment', obj: { ...dep, image: newImage, currentRS: rs, strategy, revision: (dep.revision ?? 1) + 1, updated: 0 } });
  const old = [...store.pods.values()].filter((p) => p.ns === dep.ns && p.deployment === dep.name && p.ownerRS !== rs);
  old.forEach((p, i) => {
    const at = i * 1800;
    if (safe) launch(dep, 1, () => scrap(dep, [p.name]), at);
    else {
      later(at, () => scrap(dep, [p.name]));
      launch(dep, 1, undefined, at + 300);
    }
  });
}

function scrap(dep: Deployment, names: string[]): void {
  for (const n of names) {
    const p = store.pods.get(nsKey(dep.ns, n));
    if (p) as('the Deployment controller', () => store.apply({ type: 'deleted', kind: 'Pod', obj: p }));
  }
}

/**
 * One pass of the Deployment controller's loop for one shipyard: observe
 * the ships it owns, compare with replicas, launch or scrap the difference.
 * Level-triggered: it needs no event, only the current state.
 */
export function reconcile(ns: string, name: string): { observed: number; desired: number; action: string } | undefined {
  const dep = store.deployments.get(nsKey(ns, name));
  if (!dep) return undefined;
  const own = [...store.pods.values()].filter((p) => p.ns === ns && p.deployment === name && p.phase !== 'Terminating');
  const observed = own.length;
  if (observed < dep.replicas) {
    launch(dep, dep.replicas - observed);
    return { observed, desired: dep.replicas, action: `launch ${dep.replicas - observed}` };
  }
  if (observed > dep.replicas) {
    scrap(dep, own.slice(dep.replicas).map((p) => p.name));
    return { observed, desired: dep.replicas, action: `scrap ${observed - dep.replicas}` };
  }
  as('the Deployment controller', () => store.apply({ type: 'modified', kind: 'Deployment', obj: { ...dep, available: Math.min(dep.replicas, own.filter((p) => p.ready).length) } }));
  return { observed, desired: dep.replicas, action: 'nothing to do' };
}

/** The loop over every shipyard (a resync, as after a controller restart). */
export function reconcileAll(): { ns: string; name: string; observed: number; desired: number; action: string }[] {
  const out: { ns: string; name: string; observed: number; desired: number; action: string }[] = [];
  for (const d of [...store.deployments.values()]) {
    const r = reconcile(d.ns, d.name);
    if (r) out.push({ ns: d.ns, name: d.name, ...r });
  }
  return out;
}

/** An island goes dark: the node is NotReady and the kubelet's ships on it are lost; the loop relaunches them elsewhere unless paused. */
export function failNode(name: string): void {
  const n = store.nodes.get(name);
  if (!n) return;
  as('the node controller', () => store.apply({ type: 'modified', kind: 'Node', obj: { ...n, ready: false } }));
  const lost = [...store.pods.values()].filter((p) => p.node === name);
  later(900, () => {
    for (const p of lost) as('the node controller', () => store.apply({ type: 'deleted', kind: 'Pod', obj: p }));
    later(700, () => { if (!controllers.paused) reconcileAll(); });
  });
}

export function restoreNode(name: string): void {
  const n = store.nodes.get(name);
  if (n) as('the kubelet', () => store.apply({ type: 'modified', kind: 'Node', obj: { ...n, ready: true } }));
}

/** A pod's ensign changed: selectors re-evaluate. A ship that no longer flies its shipyard's label is orphaned and replaced. */
function relabelPod(p: Pod, labels: Record<string, string>): void {
  const dep = p.deployment ? store.deployments.get(nsKey(p.ns, p.deployment)) : undefined;
  const stillOwned = !!dep && labels['app'] === dep.name;
  const next: Pod = { ...p, labels };
  if (dep && !stillOwned) {
    delete next.deployment;
    delete next.ownerRS;
    delete next.ownerKind;
    delete next.ownerName;
  }
  store.apply({ type: 'modified', kind: 'Pod', obj: next });
  if (dep && !stillOwned) {
    later(400, () => {
      const cur = store.deployments.get(nsKey(dep.ns, dep.name));
      if (cur) as('the Deployment controller', () => store.apply({ type: 'modified', kind: 'Deployment', obj: { ...cur, available: Math.max(0, cur.available - 1) } }));
      launch(dep, 1);
    });
  }
}

/** Lines only on one side, "- old" / "+ new": the simulator's apply diff. */
function lineDiff(a: string, b: string): string {
  const al = a.split('\n');
  const bl = b.split('\n');
  const out: string[] = [];
  for (const l of al) if (!bl.includes(l)) out.push(`- ${l}`);
  for (const l of bl) if (!al.includes(l)) out.push(`+ ${l}`);
  return out.join('\n');
}

type Doc = { apiVersion?: string; kind?: string; metadata?: { name?: string; namespace?: string; labels?: Record<string, string> }; spec?: Record<string, unknown>; data?: Record<string, string>; stringData?: Record<string, string> };

/** Server-side apply, the training harbor's way: whitelisted kinds into the store. */
function applyDocs(manifest: string, dryRun: boolean): { results: { kind: string; ns: string; name: string; action: 'created' | 'configured' | 'unchanged'; diff?: string }[] } {
  const docs = loadAll(manifest).filter((d): d is Doc => !!d && typeof d === 'object');
  if (docs.length === 0) throw new Error('the manifest is empty');
  const allowed = ['apps/v1/Deployment', 'v1/Service', 'v1/ConfigMap', 'v1/Secret', 'v1/Namespace', 'networking.k8s.io/v1/Ingress'];
  for (const d of docs) {
    const key = `${d.apiVersion}/${d.kind}`;
    if (!allowed.includes(key)) throw new Error(`${key} is not something the harbor applies (allowed: Deployment, Service, ConfigMap, Secret, Namespace, Ingress)`);
    if (!d.metadata?.name) throw new Error(`${d.kind} needs metadata.name`);
    if (d.kind !== 'Namespace' && !d.metadata.namespace) throw new Error(`${d.kind} ${d.metadata.name} needs metadata.namespace`);
  }
  const results: { kind: string; ns: string; name: string; action: 'created' | 'configured' | 'unchanged'; diff?: string }[] = [];
  for (const d of docs) {
    const kind = d.kind!;
    const name = d.metadata!.name!;
    const ns = d.metadata!.namespace ?? '';
    const spec = d.spec ?? {};
    const item = (action: 'created' | 'configured' | 'unchanged', diff?: string) => results.push({ kind, ns, name, action, ...(diff ? { diff } : {}) });
    if (kind === 'Deployment') {
      const cur = store.deployments.get(nsKey(ns, name));
      const tmpl = spec['template'] as { metadata?: { labels?: Record<string, string> }; spec?: { containers?: { image?: string }[] } } | undefined;
      const image = tmpl?.spec?.containers?.[0]?.image ?? cur?.image ?? 'nginx:1.27-alpine';
      const replicas = typeof spec['replicas'] === 'number' ? spec['replicas'] : cur?.replicas ?? 1;
      if (!cur) {
        if (!dryRun) simulate('POST', '/api/deployments', { ns, name, image, replicas });
        item('created');
        continue;
      }
      const before = simulatedSpecYaml(store, 'Deployment', ns, name) ?? '';
      const changedImage = image !== cur.image;
      const changedReplicas = replicas !== cur.replicas;
      if (!changedImage && !changedReplicas) {
        item('unchanged');
        continue;
      }
      if (!dryRun) {
        if (changedReplicas) simulate('PATCH', `/api/deployments/${ns}/${name}/scale`, { replicas });
        if (changedImage) simulate('PATCH', `/api/deployments/${ns}/${name}/refit`, { image });
      }
      const after = before.replace(/replicas: \d+/, `replicas: ${replicas}`).replace(cur.image, image);
      item('configured', lineDiff(before, after));
    } else if (kind === 'Service') {
      const exists = store.services.has(nsKey(ns, name));
      const ports = (spec['ports'] as { port?: number; targetPort?: number }[] | undefined) ?? [];
      if (!dryRun && !exists) simulate('POST', '/api/services', { ns, name, selector: (spec['selector'] as Record<string, string>) ?? {}, port: ports[0]?.port ?? 80, targetPort: ports[0]?.targetPort, type: spec['type'] });
      item(exists ? 'unchanged' : 'created');
    } else if (kind === 'ConfigMap' || kind === 'Secret') {
      const exists = trainingOrders.has(nsKey(ns, name));
      if (!dryRun && !exists) simulate('POST', '/api/orders', { ns, name, kind, data: d.data ?? d.stringData ?? {} });
      item(exists ? 'unchanged' : 'created');
    } else if (kind === 'Namespace') {
      const exists = store.namespaces.has(name);
      if (!dryRun && !exists) simulate('POST', '/api/namespaces', { name });
      item(exists ? 'unchanged' : 'created');
    } else if (kind === 'Ingress') {
      const exists = store.ingresses.has(nsKey(ns, name));
      const rule = (spec['rules'] as { host?: string; http?: { paths?: { path?: string; backend?: { service?: { name?: string; port?: { number?: number; name?: string } } } }[] } }[] | undefined)?.[0];
      const path0 = rule?.http?.paths?.[0];
      if (!dryRun && !exists) simulate('POST', '/api/ingresses', { ns, name, host: rule?.host, path: path0?.path, service: path0?.backend?.service?.name ?? '', port: String(path0?.backend?.service?.port?.number ?? path0?.backend?.service?.port?.name ?? '80'), class: spec['ingressClassName'] });
      item(exists ? 'unchanged' : 'created');
    }
  }
  return { results };
}

/** Answers an API call as the training harbor would. Returns the response body. */
export function simulate(method: string, path: string, body: unknown): unknown {
  // Changes the simulator makes right away in answer to a call are yours; its controllers stamp their own later.
  const prevActor = ledger.actor;
  ledger.actor = 'you';
  try {
    return simulateNow(method, path, body);
  } finally {
    ledger.actor = prevActor;
  }
}

function simulateNow(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  let m: RegExpExecArray | null;
  if ((m = /^\/api\/objects\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path)) && method === 'GET') {
    const p = simulatedPapers(store, decodeURIComponent(m[1]!), decodeURIComponent(m[2]!) === '-' ? '' : decodeURIComponent(m[2]!), decodeURIComponent(m[3]!));
    if (!p) throw new Error('no such object in the training harbor');
    return p;
  }
  if (method === 'POST' && path === '/api/apply') {
    const req = b as { manifest: string; dryRun?: boolean };
    return applyDocs(req.manifest ?? '', !!req.dryRun);
  }
  if ((m = /^\/api\/pods\/([^/]+)\/([^/]+)\/labels$/.exec(path)) && method === 'PATCH') {
    const p = store.pods.get(nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)));
    if (!p) throw new Error('no such ship');
    const req = b as { set?: Record<string, string>; remove?: string[] };
    const labels = { ...p.labels, ...(req.set ?? {}) };
    for (const k of req.remove ?? []) delete labels[k];
    relabelPod(p, labels);
    return undefined;
  }
  if ((m = /^\/api\/deployments\/([^/]+)\/([^/]+)\/labels$/.exec(path)) && method === 'PATCH') {
    const dep = store.deployments.get(nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)));
    if (!dep) throw new Error('no such shipyard');
    const req = b as { set?: Record<string, string>; remove?: string[] };
    if (req.remove?.includes('app') || (req.set && 'app' in req.set && req.set['app'] !== dep.name)) throw new Error('label app is part of the selector and cannot change on the template');
    const tl = { ...(dep.templateLabels ?? {}), ...(req.set ?? {}) };
    delete tl['app'];
    for (const k of req.remove ?? []) delete tl[k];
    store.apply({ type: 'modified', kind: 'Deployment', obj: { ...dep, templateLabels: tl } });
    return undefined;
  }
  if (method === 'POST' && path === '/api/workloads/statefulsets') {
    const req = b as { ns: string; name: string; image: string; replicas: number; mapPos?: { x: number; y: number } };
    const wl: Workload = { kind: 'StatefulSet', ns: req.ns, name: req.name, image: req.image, desired: req.replicas, ready: 0, conditions: [], ...(req.mapPos ? { mapPos: req.mapPos } : {}) };
    store.apply({ type: 'modified', kind: 'Workload', obj: wl });
    for (let i = 0; i < req.replicas; i++) {
      const name = `${req.name}-${i}`;
      const tanker = (phase: 'Pending' | 'Running', node: string): Pod => ({ ...podOf(req.ns, name, '', node, phase), ownerKind: 'StatefulSet', ownerName: req.name, labels: { app: req.name }, containers: [req.name] });
      store.apply({ type: 'modified', kind: 'Pod', obj: tanker('Pending', '') });
      later(1200 + i * 900, () => {
        const ns = nodes();
        store.apply({ type: 'modified', kind: 'Pod', obj: tanker('Running', ns[i % Math.max(1, ns.length)] ?? '') });
        const cur = store.workloads.get(`StatefulSet:${nsKey(req.ns, req.name)}`);
        if (cur) store.apply({ type: 'modified', kind: 'Workload', obj: { ...cur, ready: Math.min(cur.desired, cur.ready + 1) } });
      });
    }
    return wl;
  }
  if (method === 'POST' && path === '/api/workloads/jobs') {
    const req = b as { ns: string; name: string; image: string; completions?: number; parallelism?: number };
    const total = req.completions ?? 1;
    const wl: Workload = { kind: 'Job', ns: req.ns, name: req.name, image: req.image, desired: total, ready: 0, active: Math.min(total, req.parallelism ?? 1), failed: 0, complete: false, conditions: [] };
    store.apply({ type: 'modified', kind: 'Workload', obj: wl });
    for (let i = 0; i < total; i++) {
      const name = `${req.name}-${(++seq).toString(36)}`;
      const boat = (phase: 'Pending' | 'Running' | 'Succeeded', node: string): Pod => ({ ...podOf(req.ns, name, '', node, phase === 'Succeeded' ? 'Running' : phase), phase, ready: phase === 'Running', ownerKind: 'Job', ownerName: req.name, labels: { app: req.name }, containers: [req.name] });
      store.apply({ type: 'modified', kind: 'Pod', obj: boat('Pending', '') });
      const ns = nodes();
      const node = ns[i % Math.max(1, ns.length)] ?? '';
      later(900 + i * 700, () => store.apply({ type: 'modified', kind: 'Pod', obj: boat('Running', node) }));
      later(3500 + i * 700, () => {
        store.apply({ type: 'modified', kind: 'Pod', obj: boat('Succeeded', node) });
        const cur = store.workloads.get(`Job:${nsKey(req.ns, req.name)}`);
        if (cur) {
          const ready = Math.min(cur.desired, cur.ready + 1);
          store.apply({ type: 'modified', kind: 'Workload', obj: { ...cur, ready, active: Math.max(0, (cur.active ?? 0) - 1), complete: ready >= cur.desired } });
        }
      });
    }
    return wl;
  }
  if ((m = /^\/api\/workloads\/Job\/([^/]+)\/([^/]+)$/.exec(path)) && method === 'DELETE') {
    const key = `Job:${nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!))}`;
    const wl = store.workloads.get(key);
    if (!wl) throw new Error('no such fleet');
    for (const p of [...store.pods.values()].filter((p) => p.ns === wl.ns && p.ownerKind === 'Job' && p.ownerName === wl.name)) store.apply({ type: 'deleted', kind: 'Pod', obj: p });
    store.apply({ type: 'deleted', kind: 'Workload', obj: wl });
    return undefined;
  }
  if (method === 'POST' && path === '/api/ingresses') {
    const req = b as { ns: string; name: string; host?: string; path?: string; service: string; port: string; tls?: boolean; class?: string };
    const ing = { ns: req.ns, name: req.name, hosts: req.host ? [req.host] : [], tls: !!req.tls, addresses: [], rules: [{ host: req.host ?? '', path: req.path ?? '/', service: req.service, port: req.port }], ...(req.class ? { class: req.class } : {}) };
    store.apply({ type: 'modified', kind: 'Ingress', obj: ing });
    return ing;
  }
  if ((m = /^\/api\/orders\?ns=([^&]+)$/.exec(path)) && method === 'GET') {
    const ns = decodeURIComponent(m[1]!);
    return [...trainingOrders.values()].filter((o) => o.ns === ns);
  }
  if (method === 'POST' && path === '/api/orders') {
    const req = b as { ns: string; name: string; kind: 'ConfigMap' | 'Secret'; data: Record<string, string> };
    if (!Object.keys(req.data ?? {}).length) throw new Error('orders need at least one key');
    if (trainingOrders.has(nsKey(req.ns, req.name))) throw new Error('orders of that name are already sealed');
    const o = { ns: req.ns, name: req.name, kind: req.kind, keys: Object.keys(req.data).sort() };
    trainingOrders.set(nsKey(req.ns, req.name), o);
    return o;
  }
  if ((m = /^\/api\/orders\/(ConfigMap|Secret)\/([^/]+)\/([^/]+)$/.exec(path)) && method === 'DELETE') {
    if (!trainingOrders.delete(nsKey(decodeURIComponent(m[2]!), decodeURIComponent(m[3]!)))) throw new Error('no such orders');
    return undefined;
  }
  if (method === 'POST' && path === '/api/services') {
    const req = b as { ns: string; name: string; selector: Record<string, string>; port: number; targetPort?: number; type?: string };
    if (!Object.keys(req.selector ?? {}).length) throw new Error('selector needs at least one label');
    if (store.services.has(nsKey(req.ns, req.name))) throw new Error('a lighthouse of that name already stands');
    const svc = { ns: req.ns, name: req.name, type: req.type || 'ClusterIP', clusterIP: `10.96.${(++seq % 250) + 1}.${(seq * 7) % 250}`, ports: [{ port: req.port, targetPort: String(req.targetPort ?? req.port), protocol: 'TCP', name: 'http' }], selector: req.selector };
    store.apply({ type: 'modified', kind: 'Service', obj: svc });
    return svc;
  }
  if ((m = /^\/api\/services\/([^/]+)\/([^/]+)$/.exec(path)) && method === 'DELETE') {
    const svc = store.services.get(nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)));
    if (!svc) throw new Error('no such lighthouse');
    store.apply({ type: 'deleted', kind: 'Service', obj: svc });
    return undefined;
  }
  if (method === 'POST' && path === '/api/deployments') {
    const req = b as { ns: string; name: string; image: string; replicas: number; mapPos?: { x: number; y: number }; readinessPath?: string; livenessPath?: string; cpuRequest?: string; memRequest?: string; cpuLimit?: string; memLimit?: string; orders?: { kind: string; name: string }[] };
    if (store.deployments.has(nsKey(req.ns, req.name))) throw new Error('a shipyard of that name already stands');
    const limits = [req.cpuLimit ? `cpu ${req.cpuLimit}` : '', req.memLimit ? `mem ${req.memLimit}` : ''].filter(Boolean).join(' · ');
    const dep: Deployment = {
      ns: req.ns, name: req.name, image: req.image, replicas: req.replicas, available: 0, updated: 0, conditions: [],
      requests: `cpu ${req.cpuRequest || '50m'} · mem ${req.memRequest || '64Mi'}`,
      strategy: 'RollingUpdate maxUnavailable=25% maxSurge=25%', revision: 1,
      ...(limits ? { limits } : {}),
      ...(req.orders?.length ? { orders: req.orders.map((o) => `${o.kind}/${o.name}`) } : {}),
      ...(req.mapPos ? { mapPos: req.mapPos } : {}),
      ...(req.readinessPath ? { readiness: `http ${req.readinessPath}` } : {}),
      ...(req.livenessPath ? { liveness: `http ${req.livenessPath}` } : {}),
    };
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep });
    launch(dep, req.replicas);
    return dep;
  }
  if ((m = /^\/api\/deployments\/([^/]+)\/([^/]+)\/scale$/.exec(path)) && method === 'PATCH') {
    const dep = store.deployments.get(nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)));
    if (!dep) throw new Error('no such shipyard in the training harbor');
    const target = Number(b['replicas']);
    const retire = (b['retireFirst'] as string[] | undefined) ?? [];
    const own = [...store.pods.values()].filter((p) => p.ns === dep.ns && p.deployment === dep.name);
    store.apply({ type: 'modified', kind: 'Deployment', obj: { ...dep, replicas: target, available: Math.min(dep.available, target) } });
    if (target > own.length) launch(dep, target - own.length);
    else if (target < own.length) scrap(dep, [...retire, ...own.map((p) => p.name).filter((n) => !retire.includes(n))].slice(0, own.length - target));
    return undefined;
  }
  if ((m = /^\/api\/deployments\/([^/]+)\/([^/]+)\/refit$/.exec(path)) && method === 'PATCH') {
    const key = nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
    const dep = store.deployments.get(key);
    if (!dep) throw new Error('no such shipyard');
    const req = b as { image: string; maxUnavailable?: string; maxSurge?: string };
    if (!req.image?.trim()) throw new Error('image is required');
    const mu = req.maxUnavailable?.trim();
    const ms = req.maxSurge?.trim();
    const strategy = mu || ms ? `RollingUpdate maxUnavailable=${mu || '25%'} maxSurge=${ms || '25%'}` : dep.strategy ?? 'RollingUpdate maxUnavailable=25% maxSurge=25%';
    trainingHistory.set(key, [...(trainingHistory.get(key) ?? []), { image: dep.image, ...(dep.currentRS ? { rs: dep.currentRS } : {}) }]);
    roll(key, req.image.trim(), strategy, /maxUnavailable=0(\s|$)/.test(strategy));
    return undefined;
  }
  if ((m = /^\/api\/deployments\/([^/]+)\/([^/]+)\/rollback$/.exec(path)) && method === 'POST') {
    const key = nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
    const dep = store.deployments.get(key);
    if (!dep) throw new Error('no such shipyard');
    const hist = trainingHistory.get(key) ?? [];
    const prev = hist.pop();
    if (!prev) throw new Error('no previous refit to roll back to');
    roll(key, prev.image, dep.strategy ?? 'RollingUpdate maxUnavailable=25% maxSurge=25%', true);
    return undefined;
  }
  if (method === 'POST' && path === '/api/namespaces') {
    const req = b as { name: string };
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(req.name ?? '')) throw new Error('name must be lowercase letters, digits and dashes');
    if (store.namespaces.has(req.name)) throw new Error('a fleet of that name exists');
    const ns = { name: req.name, phase: 'Active' };
    store.apply({ type: 'modified', kind: 'Namespace', obj: ns });
    return ns;
  }
  if ((m = /^\/api\/deployments\/([^/]+)\/([^/]+)\/mappos$/.exec(path)) && method === 'PATCH') {
    const dep = store.deployments.get(nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)));
    if (dep) store.apply({ type: 'modified', kind: 'Deployment', obj: { ...dep, mapPos: b as { x: number; y: number } } });
    return undefined;
  }
  if ((m = /^\/api\/deployments\/([^/]+)\/([^/]+)$/.exec(path)) && method === 'DELETE') {
    const dep = store.deployments.get(nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)));
    if (!dep) throw new Error('no such shipyard');
    scrap(dep, [...store.pods.values()].filter((p) => p.ns === dep.ns && p.deployment === dep.name).map((p) => p.name));
    store.apply({ type: 'deleted', kind: 'Deployment', obj: dep });
    return undefined;
  }
  if ((m = /^\/api\/pods\/([^/]+)\/([^/]+)\/logs/.exec(path))) {
    return `training harbor · ${decodeURIComponent(m[2]!)}\n[info] all hands on deck\n[info] cargo secured\n[info] ready to sail`;
  }
  if ((m = /^\/api\/pods\/([^/]+)\/([^/]+)$/.exec(path)) && method === 'DELETE') {
    const p = store.pods.get(nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)));
    if (!p) throw new Error('no such ship');
    store.apply({ type: 'deleted', kind: 'Pod', obj: p });
    if (p.deployment) {
      const dep = store.deployments.get(nsKey(p.ns, p.deployment));
      if (dep) later(600, () => { if (!controllers.paused) reconcile(dep.ns, dep.name); });
    }
    return undefined;
  }
  if ((m = /^\/api\/workloads\/StatefulSet\/([^/]+)\/([^/]+)$/.exec(path)) && method === 'DELETE') {
    const key = `StatefulSet:${nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!))}`;
    const wl = store.workloads.get(key);
    if (!wl) throw new Error('no such terminal');
    for (const p of [...store.pods.values()].filter((p) => p.ns === wl.ns && p.ownerKind === 'StatefulSet' && p.ownerName === wl.name)) store.apply({ type: 'deleted', kind: 'Pod', obj: p });
    store.apply({ type: 'deleted', kind: 'Workload', obj: wl });
    return undefined;
  }
  if ((m = /^\/api\/ingresses\/([^/]+)\/([^/]+)$/.exec(path)) && method === 'DELETE') {
    const ing = store.ingresses.get(nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)));
    if (!ing) throw new Error('no such gate');
    store.apply({ type: 'deleted', kind: 'Ingress', obj: ing });
    return undefined;
  }
  if (path === '/api/contexts') return { contexts: [{ name: 'training-harbor', cluster: 'training', user: 'cadet' }], current: 'training-harbor' };
  if (path === '/api/helm/repos' && method === 'GET') return [{ name: 'training', url: 'https://training.example/charts' }];
  if (path.startsWith('/api/helm/charts/values')) return { chart: 'training/podinfo', version: '6.15.0', values: 'replicaCount: 1\n' };
  if (path.startsWith('/api/helm/charts')) return [{ repo: 'training', name: 'podinfo', version: '6.15.0', appVersion: '6.15.0', description: 'A training chart' }];
  if (path === '/api/helm/releases' && method === 'GET') return [...store.releases.values()].map((r) => ({ ...r, chart: r.chart ?? 'podinfo', chartVersion: r.chartVersion ?? '6.15.0' }));
  if (path === '/api/helm/releases' && method === 'POST') {
    const req = b as { ns: string; name: string };
    const rel = { ns: req.ns, name: req.name, revision: 1, status: 'deployed', chart: 'podinfo', chartVersion: '6.15.0' };
    store.apply({ type: 'modified', kind: 'HelmRelease', obj: rel });
    const dep: Deployment = { ns: req.ns, name: `${req.name}-podinfo`, image: 'podinfo:6.15.0', replicas: 1, available: 0, updated: 0, conditions: [], release: req.name };
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep });
    launch(dep, 1);
    return rel;
  }
  if ((m = /^\/api\/helm\/releases\/([^/]+)\/([^/]+)$/.exec(path)) && method === 'DELETE') {
    const key = nsKey(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
    const rel = store.releases.get(key);
    if (!rel) throw new Error('no such anchorage');
    for (const dep of [...store.deployments.values()].filter((d) => d.ns === rel.ns && d.release === rel.name)) simulate('DELETE', `/api/deployments/${dep.ns}/${dep.name}`, undefined);
    store.apply({ type: 'deleted', kind: 'HelmRelease', obj: rel });
    return undefined;
  }
  eva.emit('TRAINING: that command is not simulated here');
  return undefined;
}
