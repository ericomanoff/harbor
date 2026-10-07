import { describe, expect, it } from 'vitest';
import type { Deployment, Pod } from '../store/cluster';
import { searchObjects } from './search';

const dep = (ns: string, name: string): Deployment => ({ ns, name, replicas: 1, available: 1, updated: 1, image: 'x', conditions: [] });
const pod = (ns: string, name: string): Pod => ({ ns, name, node: 'n', phase: 'Running', ready: true, restarts: 0, created: 'x' });
const store = {
  deployments: new Map([['sandbox/nginx', dep('sandbox', 'nginx')], ['default/api', dep('default', 'api')]]),
  pods: new Map([['sandbox/nginx-1', pod('sandbox', 'nginx-1')], ['default/api-x', pod('default', 'api-x')], ['kube-system/coredns-1', pod('kube-system', 'coredns-1')]]),
};

describe('searchObjects', () => {
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
