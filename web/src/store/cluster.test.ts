import { describe, expect, it } from 'vitest';
import { ClusterStore, type Snapshot, type StoreEvent } from './cluster';

const snap: Snapshot = {
  context: 'kind-harbor',
  nodes: [{ name: 'w1', ready: true, cpuAlloc: 4000, memAlloc: 1, cpuReq: 0, memReq: 0, labels: {} }],
  namespaces: [{ name: 'sandbox', phase: 'Active' }],
  deployments: [{ ns: 'sandbox', name: 'nginx', replicas: 2, available: 2, updated: 2, image: 'nginx', conditions: [] }],
  pods: [
    { ns: 'sandbox', name: 'nginx-1', node: 'w1', phase: 'Running', ready: true, restarts: 0, created: '2026-10-07T00:00:00Z', deployment: 'nginx', labels: {}, containers: [] },
  ],
  releases: [{ ns: 'sandbox', name: 'outpost', revision: 1, status: 'deployed' }],
  services: [], workloads: [], ingresses: [],
};

describe('ClusterStore', () => {
  it('replaces state from a snapshot message and emits snapshot', () => {
    const s = new ClusterStore();
    const seen: StoreEvent[] = [];
    s.subscribe((e) => seen.push(e));
    s.apply({ type: 'snapshot', kind: 'Snapshot', obj: snap });
    expect(s.context).toBe('kind-harbor');
    expect(s.nodes.get('w1')?.cpuAlloc).toBe(4000);
    expect(s.deployments.get('sandbox/nginx')?.replicas).toBe(2);
    expect(s.pods.get('sandbox/nginx-1')?.node).toBe('w1');
    expect(seen).toEqual([{ type: 'snapshot' }]);
  });

  it('applies upserts and deletes with keyed events', () => {
    const s = new ClusterStore();
    s.replace(snap);
    const seen: StoreEvent[] = [];
    s.subscribe((e) => seen.push(e));

    s.apply({ type: 'modified', kind: 'Pod', obj: { ns: 'sandbox', name: 'nginx-2', node: '', phase: 'Pending', ready: false, restarts: 0, created: 'x', labels: {}, containers: [] } });
    expect(s.pods.size).toBe(2);
    s.apply({ type: 'deleted', kind: 'Pod', obj: { ns: 'sandbox', name: 'nginx-1', node: 'w1', phase: 'Deleted', ready: false, restarts: 0, created: 'x', labels: {}, containers: [] } });
    expect(s.pods.has('sandbox/nginx-1')).toBe(false);
    s.apply({ type: 'deleted', kind: 'Deployment', obj: { ns: 'sandbox', name: 'nginx', replicas: 0, available: 0, updated: 0, image: '', conditions: [] } });
    expect(s.deployments.size).toBe(0);

    expect(seen).toEqual([
      { type: 'pod', op: 'upsert', key: 'sandbox/nginx-2' },
      { type: 'pod', op: 'delete', key: 'sandbox/nginx-1' },
      { type: 'deployment', op: 'delete', key: 'sandbox/nginx' },
    ]);
  });

  it('tracks Helm releases from the snapshot and the stream', () => {
    const s = new ClusterStore();
    s.replace(snap);
    expect(s.releases.get('sandbox/outpost')?.status).toBe('deployed');
    const seen: StoreEvent[] = [];
    s.subscribe((e) => seen.push(e));
    s.apply({ type: 'modified', kind: 'HelmRelease', obj: { ns: 'sandbox', name: 'outpost', revision: 2, status: 'failed' } });
    expect(s.releases.get('sandbox/outpost')?.revision).toBe(2);
    s.apply({ type: 'deleted', kind: 'HelmRelease', obj: { ns: 'sandbox', name: 'outpost', revision: 2, status: 'uninstalled' } });
    expect(s.releases.size).toBe(0);
    expect(seen).toEqual([{ type: 'release', op: 'upsert', key: 'sandbox/outpost' }, { type: 'release', op: 'delete', key: 'sandbox/outpost' }]);
  });

  it('keeps a bounded event log', () => {
    const s = new ClusterStore();
    for (let i = 0; i < 150; i++) {
      s.apply({ type: 'added', kind: 'Event', obj: { ns: 'a', kind: 'Pod', name: `p${i}`, type: 'Warning', reason: 'BackOff', message: 'm', ts: 'x' } });
    }
    expect(s.events.length).toBe(100);
    expect(s.events[0]?.name).toBe('p50');
  });

  it('a second snapshot wipes state from the first', () => {
    const s = new ClusterStore();
    s.replace(snap);
    s.replace({ context: 'other', nodes: [], namespaces: [], deployments: [], pods: [], releases: [], services: [], workloads: [], ingresses: [] });
    expect(s.context).toBe('other');
    expect(s.pods.size).toBe(0);
    expect(s.nodes.size).toBe(0);
  });
});
