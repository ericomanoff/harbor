import { describe, expect, it } from 'vitest';
import type { Deployment, Pod } from '../store/cluster';
import { podGone, relaunched, shipyardAfloat } from './goals';

const dep = (ns: string, name: string, replicas: number, available: number): Deployment => ({ ns, name, replicas, available, updated: replicas, image: 'x', conditions: [] });
const pod = (ns: string, name: string, deployment: string | undefined, ready: boolean): Pod => ({ ns, name, node: 'n', phase: 'Running', ready, restarts: 0, created: 'x', labels: {}, containers: ['c'], ...(deployment ? { deployment } : {}) });

describe('goals', () => {
  it('shipyardAfloat needs a ready ship of a Deployment in the namespace', () => {
    const store = { deployments: new Map([['harbor/cargo', dep('harbor', 'cargo', 1, 1)]]), pods: new Map([['harbor/cargo-1', pod('harbor', 'cargo-1', 'cargo', true)]]) };
    expect(shipyardAfloat(store, 'harbor')).toBe('cargo');
    expect(shipyardAfloat(store, 'other')).toBeUndefined();
    expect(shipyardAfloat({ deployments: store.deployments, pods: new Map([['harbor/cargo-1', pod('harbor', 'cargo-1', 'cargo', false)]]) }, 'harbor')).toBeUndefined();
  });
  it('podGone and relaunched', () => {
    const pods = new Map([['harbor/cargo-2', pod('harbor', 'cargo-2', 'cargo', true)]]);
    expect(podGone({ pods }, 'harbor/cargo-1')).toBe(true);
    expect(relaunched({ pods }, 'harbor', 'cargo', 'cargo-1')).toBe(true);
    pods.set('harbor/cargo-1', pod('harbor', 'cargo-1', 'cargo', false));
    expect(relaunched({ pods }, 'harbor', 'cargo', 'cargo-1')).toBe(false);
  });
});
