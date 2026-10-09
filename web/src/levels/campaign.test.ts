import { describe, expect, it } from 'vitest';
import { ClusterStore } from '../store/cluster';
import { campaignLevels, campaignStep, goalMet } from './campaign';

const ctx = (store: ClusterStore) => ({ store, mode: 'live' as const, ns: 'default', play: () => () => {}, simulate: () => undefined, sink: () => undefined, stage: async () => undefined, orders: () => [{ kind: 'Secret', name: 'reg' }] });

describe('campaign goals and steps', () => {
  it('evaluates goals over the store and the orders list', () => {
    const store = new ClusterStore();
    store.replace({ context: 'c', nodes: [], namespaces: [{ name: 'fx', phase: 'Active' }], deployments: [{ ns: 'fx', name: 'ui', replicas: 2, available: 2, updated: 2, image: 'x', conditions: [] }], pods: [], services: [], workloads: [], ingresses: [], releases: [{ ns: 'fx', name: 'fx', revision: 2, status: 'deployed' }] });
    const orders = () => [{ kind: 'Secret', name: 'reg' }];
    expect(goalMet({ kind: 'namespace-exists', name: 'fx' }, store, orders)).toBe(true);
    expect(goalMet({ kind: 'orders-exist', name: 'reg', orders: 'Secret' }, store, orders)).toBe(true);
    expect(goalMet({ kind: 'orders-exist', name: 'reg', orders: 'ConfigMap' }, store, orders)).toBe(false);
    expect(goalMet({ kind: 'deployment-ready', ns: 'fx', name: 'ui' }, store, orders)).toBe(true);
    expect(goalMet({ kind: 'release-deployed', ns: 'fx', name: 'fx' }, store, orders)).toBe(true);
    expect(goalMet({ kind: 'release-revision', ns: 'fx', name: 'fx', min: 3 }, store, orders)).toBe(false);
    expect(goalMet({ kind: 'ingress-exists', ns: 'fx', name: 'fx' }, store, orders)).toBe(false);
  });
  it('turns checks into action steps that wait for a passing probe', async () => {
    const store = new ClusterStore();
    const results = new Map<number, boolean>();
    const s = campaignStep({ kind: 'check', probe: 'kube-version', args: { min: '1.25' }, title: 'Version' }, 0, ctx(store), results);
    expect(s.action?.label).toBe('Run check');
    expect(s.waitFor?.()).toBe(false);
    results.set(0, true);
    expect(s.waitFor?.()).toBe(true);
    const f = campaignStep({ kind: 'form', form: 'orders', goal: { kind: 'orders-exist', name: 'reg' } }, 1, ctx(store), results);
    expect(f.waitFor?.()).toBe(true);
  });
  it('maps a campaign to live levels with summaries', () => {
    const levels = campaignLevels({ id: 'fx', title: 'FX', levels: [{ id: 'a', title: 'A', steps: [{ kind: 'instruct', text: 'hi' }], summary: { naval: 'n', kubectl: 'kubectl get all\n' } }] });
    expect(levels[0]?.id).toBe('fx/a');
    expect(levels[0]?.live).toBe(true);
    expect(levels[0]?.summary(new ClusterStore()).kubectl).toBe('kubectl get all');
  });
});
