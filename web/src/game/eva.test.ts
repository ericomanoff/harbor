import { describe, expect, it } from 'vitest';
import { ClusterStore, type Deployment, type Pod } from '../store/cluster';
import { EvaFeed, clipLine } from './eva';

const dep = (name: string, available: number): Deployment => ({ ns: 'a', name, replicas: 1, available, updated: 1, image: 'x', conditions: [] });
const pod = (name: string): Pod => ({ ns: 'a', name, node: 'n', phase: 'Running', ready: true, restarts: 0, created: 'x', labels: {}, containers: [] });

function wired(): { store: ClusterStore; lines: string[] } {
  const store = new ClusterStore();
  const feed = new EvaFeed(store);
  const lines: string[] = [];
  store.subscribe((e) => lines.push(...feed.announce(e)));
  return { store, lines };
}

describe('EvaFeed', () => {
  it('announces the snapshot and only genuinely new objects afterwards', () => {
    const { store, lines } = wired();
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [dep('web', 1)], pods: [pod('web-1')], releases: [], services: [], workloads: [], ingresses: [] });
    store.apply({ type: 'modified', kind: 'Pod', obj: pod('web-1') }); // status churn, not news
    store.apply({ type: 'modified', kind: 'Pod', obj: pod('web-2') });
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep('web', 1) });
    expect(lines).toEqual(['BATTLEFIELD CONTROL ESTABLISHED', 'UNIT DEPLOYED: web-2']);
  });

  it('tracks construction from start to complete', () => {
    const { store, lines } = wired();
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [], pods: [], releases: [], services: [], workloads: [], ingresses: [] });
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep('radar', 0) });
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep('radar', 0) });
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep('radar', 1) });
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep('radar', 2) });
    store.apply({ type: 'deleted', kind: 'Deployment', obj: dep('radar', 2) });
    expect(lines.slice(1)).toEqual(['NEW CONSTRUCTION: a/radar', 'CONSTRUCTION COMPLETE: radar', 'STRUCTURE SOLD: a/radar']);
  });

  it('reports lost units and warning events, ignores normal events', () => {
    const { store, lines } = wired();
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [], pods: [pod('web-1')], releases: [], services: [], workloads: [], ingresses: [] });
    store.apply({ type: 'deleted', kind: 'Pod', obj: pod('web-1') });
    store.apply({ type: 'added', kind: 'Event', obj: { ns: 'a', kind: 'Pod', name: 'web-2', type: 'Warning', reason: 'BackOff', message: 'm', ts: 'x' } });
    store.apply({ type: 'added', kind: 'Event', obj: { ns: 'a', kind: 'Pod', name: 'web-2', type: 'Normal', reason: 'Pulled', message: 'm', ts: 'x' } });
    expect(lines.slice(1)).toEqual(['UNIT LOST: web-1', 'BackOff: web-2']);
  });

  it('a new snapshot resets memory so nothing is double-announced', () => {
    const { store, lines } = wired();
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [], pods: [pod('web-1')], releases: [], services: [], workloads: [], ingresses: [] });
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [], pods: [pod('web-1')], releases: [], services: [], workloads: [], ingresses: [] });
    store.apply({ type: 'modified', kind: 'Pod', obj: pod('web-1') });
    expect(lines).toEqual(['BATTLEFIELD CONTROL ESTABLISHED', 'BATTLEFIELD CONTROL ESTABLISHED']);
  });
});

describe('EvaFeed releases', () => {
  it('announces expansions, status changes and dismantling', () => {
    const { store, lines } = wired();
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [], pods: [], releases: [], services: [], workloads: [], ingresses: [] });
    const rel = (status: string, revision = 1) => ({ ns: 'a', name: 'outpost', revision, status });
    store.apply({ type: 'modified', kind: 'HelmRelease', obj: rel('pending-install') });
    store.apply({ type: 'modified', kind: 'HelmRelease', obj: rel('pending-install') });
    store.apply({ type: 'modified', kind: 'HelmRelease', obj: rel('deployed') });
    store.apply({ type: 'modified', kind: 'HelmRelease', obj: rel('failed', 2) });
    store.apply({ type: 'deleted', kind: 'HelmRelease', obj: rel('uninstalled', 2) });
    expect(lines.slice(1)).toEqual(['BASE EXPANSION: outpost', 'EXPANSION ONLINE: outpost rev 1', 'EXPANSION FAILED: outpost', 'EXPANSION DISMANTLED: outpost']);
  });
});

describe('EvaFeed workloads', () => {
  it('announces fleets sailing and landing their catch', () => {
    const { store, lines } = wired();
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [], pods: [], releases: [], services: [], workloads: [], ingresses: [] });
    const job = (complete: boolean, ready = 0) => ({ kind: 'Job' as const, ns: 'a', name: 'backup', image: 'x', desired: 1, ready, conditions: [], complete });
    store.apply({ type: 'modified', kind: 'Workload', obj: job(false) });
    store.apply({ type: 'modified', kind: 'Workload', obj: job(false) });
    store.apply({ type: 'modified', kind: 'Workload', obj: job(true, 1) });
    store.apply({ type: 'modified', kind: 'Workload', obj: { kind: 'StatefulSet', ns: 'a', name: 'db', image: 'x', desired: 1, ready: 0, conditions: [] } });
    store.apply({ type: 'modified', kind: 'Workload', obj: { kind: 'DaemonSet', ns: 'a', name: 'agent', image: 'x', desired: 1, ready: 0, conditions: [] } });
    expect(lines.slice(1)).toEqual(['FLEET SAILED: backup', 'CATCH LANDED: backup', 'NEW CONSTRUCTION: a/db']);
  });
});

describe('clipLine', () => {
  it('clips long lines with an ellipsis', () => {
    expect(clipLine('short')).toBe('short');
    expect(clipLine('x'.repeat(40), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
