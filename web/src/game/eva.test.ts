import { describe, expect, it } from 'vitest';
import { ClusterStore, type Deployment, type Pod } from '../store/cluster';
import { EvaFeed, clipLine } from './eva';

const dep = (name: string, available: number): Deployment => ({ ns: 'a', name, replicas: 1, available, updated: 1, image: 'x', conditions: [] });
const pod = (name: string): Pod => ({ ns: 'a', name, node: 'n', phase: 'Running', ready: true, restarts: 0, created: 'x' });

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
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [dep('web', 1)], pods: [pod('web-1')] });
    store.apply({ type: 'modified', kind: 'Pod', obj: pod('web-1') }); // status churn, not news
    store.apply({ type: 'modified', kind: 'Pod', obj: pod('web-2') });
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep('web', 1) });
    expect(lines).toEqual(['BATTLEFIELD CONTROL ESTABLISHED', 'UNIT DEPLOYED: web-2']);
  });

  it('tracks construction from start to complete', () => {
    const { store, lines } = wired();
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [], pods: [] });
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep('radar', 0) });
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep('radar', 0) });
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep('radar', 1) });
    store.apply({ type: 'modified', kind: 'Deployment', obj: dep('radar', 2) });
    store.apply({ type: 'deleted', kind: 'Deployment', obj: dep('radar', 2) });
    expect(lines.slice(1)).toEqual(['NEW CONSTRUCTION: a/radar', 'CONSTRUCTION COMPLETE: radar', 'STRUCTURE SOLD: a/radar']);
  });

  it('reports lost units and warning events, ignores normal events', () => {
    const { store, lines } = wired();
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [], pods: [pod('web-1')] });
    store.apply({ type: 'deleted', kind: 'Pod', obj: pod('web-1') });
    store.apply({ type: 'added', kind: 'Event', obj: { ns: 'a', kind: 'Pod', name: 'web-2', type: 'Warning', reason: 'BackOff', message: 'm', ts: 'x' } });
    store.apply({ type: 'added', kind: 'Event', obj: { ns: 'a', kind: 'Pod', name: 'web-2', type: 'Normal', reason: 'Pulled', message: 'm', ts: 'x' } });
    expect(lines.slice(1)).toEqual(['UNIT LOST: web-1', 'BackOff: web-2']);
  });

  it('a new snapshot resets memory so nothing is double-announced', () => {
    const { store, lines } = wired();
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [], pods: [pod('web-1')] });
    store.replace({ context: 'c', nodes: [], namespaces: [], deployments: [], pods: [pod('web-1')] });
    store.apply({ type: 'modified', kind: 'Pod', obj: pod('web-1') });
    expect(lines).toEqual(['BATTLEFIELD CONTROL ESTABLISHED', 'BATTLEFIELD CONTROL ESTABLISHED']);
  });
});

describe('clipLine', () => {
  it('clips long lines with an ellipsis', () => {
    expect(clipLine('short')).toBe('short');
    expect(clipLine('x'.repeat(40), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
