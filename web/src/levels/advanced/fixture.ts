import type { Deployment, Pod, Service, Snapshot } from '../../store/cluster';
import type { ScriptedMessage } from '../types';

/** The academy's small harbor: two islands, a `harbor` fleet and nothing built yet. */
export function academyHarbor(extra: { pods?: Pod[]; deployments?: Deployment[]; services?: Service[] } = {}): Snapshot {
  const node = (name: string, cpu: number) => ({ name, ready: true, cpuAlloc: cpu, memAlloc: 4 * 1024 ** 3, cpuReq: 100, memReq: 128 * 1024 ** 2, labels: {} });
  return {
    context: 'academy',
    nodes: [node('harbor-control-plane', 2000), node('harbor-worker', 4000)],
    namespaces: [{ name: 'default', phase: 'Active' }, { name: 'harbor', phase: 'Active' }],
    deployments: extra.deployments ?? [],
    pods: extra.pods ?? [],
    services: extra.services ?? [],
    workloads: [],
    ingresses: [],
    releases: [],
  };
}

/** A lone ship: a bare pod with no controller behind it. */
export function loneShip(name: string, node = 'harbor-worker'): Pod {
  return { ns: 'harbor', name, node, phase: 'Running', ready: true, restarts: 0, created: new Date().toISOString(), labels: { app: 'courier' }, containers: ['courier', 'log-shipper'] };
}

/** Script: the ship strikes the reef and sinks; nothing follows. */
export function reefScript(pod: Pod): ScriptedMessage[] {
  return [
    { at: 0, msg: { type: 'added', kind: 'Event', obj: { ns: pod.ns, kind: 'Pod', name: pod.name, type: 'Warning', reason: 'Reef', message: `${pod.name} struck the reef`, ts: new Date().toISOString() } } },
    { at: 300, msg: { type: 'modified', kind: 'Pod', obj: { ...pod, ready: false, reason: 'Error' } } },
    { at: 1800, msg: { type: 'deleted', kind: 'Pod', obj: pod } },
  ];
}

/** A shipyard with its ships already moored, labelled app=<name> like the real builder does. */
export function shipyard(name: string, replicas: number, extra: Partial<Deployment> = {}): { deployment: Deployment; pods: Pod[] } {
  const pods: Pod[] = [];
  for (let i = 0; i < replicas; i++) {
    pods.push({ ns: 'harbor', name: `${name}-${'abcdef'[i]}`, node: i % 2 ? 'harbor-control-plane' : 'harbor-worker', phase: 'Running', ready: true, restarts: 0, created: new Date().toISOString(), deployment: name, labels: { app: name }, containers: [name] });
  }
  return { deployment: { ns: 'harbor', name, image: 'ghcr.io/example/courier:1.0', replicas, available: replicas, updated: replicas, conditions: [], ...extra }, pods };
}

/** A lighthouse guiding app=<fleet> on port 80. */
export function lighthouse(name: string, fleet: string): Service {
  return { ns: 'harbor', name, type: 'ClusterIP', clusterIP: '10.96.0.42', ports: [{ port: 80, targetPort: '80', protocol: 'TCP', name: 'http' }], selector: { app: fleet } };
}

/** An event about a pod, as the cluster would record it. */
export function podEvent(pod: Pod, type: 'Warning' | 'Normal', reason: string, message: string): ScriptedMessage['msg'] {
  return { type: 'added', kind: 'Event', obj: { ns: pod.ns, kind: 'Pod', name: pod.name, type, reason, message, ts: new Date().toISOString() } };
}
