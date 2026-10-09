import { describe, expect, it } from 'vitest';
import type { Deployment, Pod } from '../store/cluster';
import { lighthouseFor, lookoutsShipyard, podGone, readyShips, relaunched, shipyardAfloat } from './goals';

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

describe('C1 goals', () => {
  const pods = new Map([
    ['harbor/c-1', { ...pod('harbor', 'c-1', 'c', true), labels: { app: 'c' } }],
    ['harbor/c-2', { ...pod('harbor', 'c-2', 'c', false), labels: { app: 'c' } }],
  ]);
  it('readyShips counts only ready ones', () => {
    expect(readyShips({ pods }, 'harbor', 'c')).toBe(1);
  });
  it('lookoutsShipyard needs both probes and a ready ship', () => {
    const deployments = new Map([['harbor/c', { ...dep('harbor', 'c', 1, 1), readiness: 'http /ready', liveness: 'http /healthz' }]]);
    expect(lookoutsShipyard({ deployments, pods }, 'harbor')).toBe('c');
    expect(lookoutsShipyard({ deployments: new Map([['harbor/c', { ...dep('harbor', 'c', 1, 1), readiness: 'http /ready' }]]), pods }, 'harbor')).toBeUndefined();
  });
  it('lighthouseFor matches the selector against every ship', () => {
    const svc = (selector: Record<string, string>, ports = 1) => ({ ns: 'harbor', name: 'beam', type: 'ClusterIP', clusterIP: '1', ports: Array.from({ length: ports }, () => ({ port: 80, targetPort: '80', protocol: 'TCP' })), selector });
    expect(lighthouseFor({ services: new Map([['harbor/beam', svc({ app: 'c' })]]), pods }, 'harbor', 'c')).toBe('beam');
    expect(lighthouseFor({ services: new Map([['harbor/beam', svc({ app: 'other' })]]), pods }, 'harbor', 'c')).toBeUndefined();
    expect(lighthouseFor({ services: new Map([['harbor/beam', svc({}, 1)]]), pods }, 'harbor', 'c')).toBeUndefined();
    expect(lighthouseFor({ services: new Map([['harbor/beam', svc({ app: 'c' }, 0)]]), pods }, 'harbor', 'c')).toBeUndefined();
  });
});
