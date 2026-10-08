import { describe, expect, it } from 'vitest';
import type { Deployment, Pod } from '../store/cluster';
import { sellPlan } from './commands';

const dep = (ns: string, name: string, replicas: number): Deployment => ({ ns, name, replicas, available: replicas, updated: replicas, image: 'x', conditions: [] });
const pod = (ns: string, name: string, deployment?: string): Pod => ({ ns, name, node: 'n', phase: 'Running', ready: true, restarts: 0, created: 'x', labels: {}, containers: [], ...(deployment ? { deployment } : {}) });

describe('sellPlan', () => {
  const deps = new Map([
    ['a/web', dep('a', 'web', 5)],
    ['a/api', dep('a', 'api', 1)],
  ]);

  it('groups by factory and scales each down by the count selected', () => {
    const plan = sellPlan([pod('a', 'web-1', 'web'), pod('a', 'web-2', 'web'), pod('a', 'api-1', 'api')], deps);
    expect(plan.sellable).toBe(true);
    expect(plan.groups).toEqual([
      { ns: 'a', deployment: 'web', names: ['web-1', 'web-2'], target: 3 },
      { ns: 'a', deployment: 'api', names: ['api-1'], target: 0 },
    ]);
  });

  it('never scales below zero', () => {
    const plan = sellPlan([pod('a', 'api-1', 'api'), pod('a', 'api-2', 'api')], deps);
    expect(plan.groups[0]?.target).toBe(0);
  });

  it('refuses pods without a factory or with an unknown one', () => {
    expect(sellPlan([pod('a', 'kube-proxy-x')], deps).sellable).toBe(false);
    expect(sellPlan([pod('a', 'ghost-1', 'ghost')], deps).sellable).toBe(false);
    expect(sellPlan([], deps).sellable).toBe(false);
  });
});
