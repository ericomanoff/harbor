import { eva, link, source, store } from '../app';
import { demoSnapshot } from '../demo/demo';
import { connectWebSocket } from '../store/source';
import { startDemo } from '../demo/demo';
import { nsKey, type Deployment, type Pod } from '../store/cluster';

/**
 * Training harbor: the tour runs on demo data, and every API call the HUD
 * would make is answered here instead of by the backend, so a learner can
 * build, launch, scrap and sell without touching a real cluster.
 */
export const training = { active: false };

let liveWasDemo = false;

export function enterTraining(): void {
  if (training.active) return;
  liveWasDemo = new URLSearchParams(location.search).has('demo');
  source.stop?.();
  source.stop = undefined;
  training.active = true;
  store.replace(demoSnapshot());
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

const podOf = (ns: string, name: string, deployment: string, nodeName: string, phase: 'Pending' | 'Running'): Pod => ({
  ns, name, node: nodeName, phase, ready: phase === 'Running', restarts: 0, created: new Date().toISOString(), deployment,
  labels: { app: deployment }, containers: [deployment],
});

const nodes = (): string[] => [...store.nodes.values()].filter((n) => n.ready).map((n) => n.name);
let seq = 0;

function launch(dep: Deployment, count: number): void {
  for (let i = 0; i < count; i++) {
    const name = `${dep.name}-trn-${(++seq).toString(36)}`;
    store.apply({ type: 'modified', kind: 'Pod', obj: podOf(dep.ns, name, dep.name, '', 'Pending') });
    later(1200 + i * 400, () => {
      const ns = nodes();
      const node = ns[seq % Math.max(1, ns.length)] ?? '';
      store.apply({ type: 'modified', kind: 'Pod', obj: podOf(dep.ns, name, dep.name, node, 'Running') });
      const cur = store.deployments.get(nsKey(dep.ns, dep.name));
      if (cur) store.apply({ type: 'modified', kind: 'Deployment', obj: { ...cur, available: Math.min(cur.replicas, cur.available + 1), updated: cur.replicas } });
    });
  }
}

function scrap(dep: Deployment, names: string[]): void {
  for (const n of names) {
    const p = store.pods.get(nsKey(dep.ns, n));
    if (p) store.apply({ type: 'deleted', kind: 'Pod', obj: p });
  }
}

/** Answers an API call as the training harbor would. Returns the response body. */
export function simulate(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  let m: RegExpExecArray | null;
  if (method === 'POST' && path === '/api/deployments') {
    const req = b as { ns: string; name: string; image: string; replicas: number; mapPos?: { x: number; y: number } };
    const dep: Deployment = { ns: req.ns, name: req.name, image: req.image, replicas: req.replicas, available: 0, updated: 0, conditions: [], ...(req.mapPos ? { mapPos: req.mapPos } : {}) };
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
      if (dep) later(600, () => launch(dep, 1));
    }
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
