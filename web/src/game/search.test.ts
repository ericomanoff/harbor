import { describe, expect, it } from 'vitest';
import type { Deployment, Node, Pod } from '../store/cluster';
import { searchObjects } from './search';

const dep = (ns: string, name: string): Deployment => ({ ns, name, replicas: 1, available: 1, updated: 1, image: 'x', conditions: [] });
const pod = (ns: string, name: string): Pod => ({ ns, name, node: 'n', phase: 'Running', ready: true, restarts: 0, created: 'x', labels: {}, containers: [] });
const store = {
  deployments: new Map([['sandbox/nginx', dep('sandbox', 'nginx')], ['default/api', dep('default', 'api')]]),
  pods: new Map([['sandbox/nginx-1', pod('sandbox', 'nginx-1')], ['default/api-x', pod('default', 'api-x')], ['kube-system/coredns-1', pod('kube-system', 'coredns-1')]]),
};

const node = (name: string): Node => ({ name, ready: true, cpuAlloc: 4000, memAlloc: 0, cpuReq: 0, memReq: 0, labels: {} });

describe('searchObjects', () => {
  it('finds islands by node name, keyed for the map', () => {
    const hits = searchObjects('harbor-w', { ...store, nodes: new Map([['harbor-worker', node('harbor-worker')], ['harbor-control-plane', node('harbor-control-plane')]]) });
    expect(hits.map((h) => h.key)).toEqual(['dock:harbor-worker']);
    expect(hits[0]).toMatchObject({ kind: 'island', ns: '', name: 'harbor-worker' });
  });

  it('returns nothing for a blank query', () => {
    expect(searchObjects('  ', store)).toEqual([]);
  });
  it('ranks structures before units and prefix before substring', () => {
    const keys = searchObjects('ngi', store).map((h) => h.key);
    expect(keys).toEqual(['b:sandbox/nginx', 'u:sandbox/nginx-1']);
    const sub = searchObjects('dns', store);
    expect(sub).toEqual([{ key: 'u:kube-system/coredns-1', kind: 'unit', ns: 'kube-system', name: 'coredns-1' }]);
  });
  it('matches on namespace too and is case-insensitive', () => {
    expect(searchObjects('DEFAULT', store).map((h) => h.key)).toEqual(['b:default/api', 'u:default/api-x']);
  });
  it('honours the limit', () => {
    expect(searchObjects('a', store, 1)).toHaveLength(1);
  });
});
