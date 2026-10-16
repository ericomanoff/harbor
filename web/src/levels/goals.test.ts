import { describe, expect, it } from 'vitest';
import type { Deployment, Pod } from '../store/cluster';
import { cappedShipyard, crashShips, fleetRefitted, gateFor, lighthouseAimedAt, shipsWithLabels, lighthouseFor, lookoutsShipyard, ordersShipyard, podGone, readyShips, relaunched, shipyardAfloat } from './goals';

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

describe('C2 goals', () => {
  const pods = new Map([['harbor/c-1', pod('harbor', 'c-1', 'c', true)]]);
  it('gateFor finds a gate with a rule to the lighthouse', () => {
    const ingresses = new Map([['harbor/shop', { ns: 'harbor', name: 'shop', hosts: ['shop.example'], tls: true, addresses: [], rules: [{ host: 'shop.example', path: '/', service: 'courier', port: '80' }] }]]);
    expect(gateFor({ ingresses }, 'harbor', 'courier')).toBe('shop');
    expect(gateFor({ ingresses }, 'harbor', 'other')).toBeUndefined();
  });
  it('ordersShipyard and cappedShipyard read the wire summaries', () => {
    const deployments = new Map([['harbor/c', { ...dep('harbor', 'c', 1, 1), orders: ['ConfigMap/c-orders'], requests: 'cpu 100m · mem 64Mi', limits: 'cpu 200m · mem 128Mi' }]]);
    expect(ordersShipyard({ deployments, pods }, 'harbor', 'ConfigMap/c-orders')).toBe('c');
    expect(ordersShipyard({ deployments, pods }, 'harbor', 'Secret/c-orders')).toBeUndefined();
    expect(cappedShipyard({ deployments, pods }, 'harbor')).toBe('c');
    expect(cappedShipyard({ deployments: new Map([['harbor/c', { ...dep('harbor', 'c', 1, 1), requests: 'cpu 100m', limits: 'cpu 200m' }]]), pods }, 'harbor')).toBeUndefined();
  });
});

describe('C3 goals', () => {
  const d = { ...dep('harbor', 'c', 2, 2), image: 'c:1.0', currentRS: 'c-2' };
  it('crashShips and fleetRefitted', () => {
    const pods = new Map([
      ['harbor/a', { ...pod('harbor', 'a', 'c', true), ownerRS: 'c-2' }],
      ['harbor/b', { ...pod('harbor', 'b', 'c', false), ownerRS: 'c-2', reason: 'CrashLoopBackOff' }],
    ]);
    expect(crashShips({ pods }, 'harbor', 'c')).toBe(1);
    expect(fleetRefitted({ deployments: new Map([['harbor/c', d]]), pods }, 'harbor', 'c', 'c:1.0', 1)).toBe(false);
    pods.set('harbor/b', { ...pod('harbor', 'b', 'c', true), ownerRS: 'c-2' });
    expect(fleetRefitted({ deployments: new Map([['harbor/c', d]]), pods }, 'harbor', 'c', 'c:1.0', 2)).toBe(true);
    pods.set('harbor/b', { ...pod('harbor', 'b', 'c', true), ownerRS: 'c-1' });
    expect(fleetRefitted({ deployments: new Map([['harbor/c', d]]), pods }, 'harbor', 'c', 'c:1.0', 2)).toBe(false);
    expect(fleetRefitted({ deployments: new Map([['harbor/c', d]]), pods }, 'harbor', 'c', 'c:2.0', 1)).toBe(false);
  });
});

describe('F2 goals', () => {
  it('counts ships by labels and finds a lighthouse by exact selector', () => {
    const pods = new Map([
      ['harbor/a', { ...pod('harbor', 'a', 'c', true), labels: { app: 'c', track: 'blue' } }],
      ['harbor/b', { ...pod('harbor', 'b', 'c', true), labels: { app: 'c', track: 'green' } }],
      ['harbor/x', { ...pod('harbor', 'x', 'c', false), labels: { app: 'c', track: 'green' } }],
    ]);
    expect(shipsWithLabels({ pods }, 'harbor', { app: 'c' })).toBe(2);
    expect(shipsWithLabels({ pods }, 'harbor', { track: 'green' })).toBe(1);
    const services = new Map([['harbor/beam', { ns: 'harbor', name: 'beam', type: 'ClusterIP', clusterIP: '1', ports: [], selector: { track: 'blue' } }]]);
    expect(lighthouseAimedAt({ services }, 'harbor', { track: 'blue' })).toBe('beam');
    expect(lighthouseAimedAt({ services }, 'harbor', { app: 'c', track: 'blue' })).toBeUndefined();
  });
});
