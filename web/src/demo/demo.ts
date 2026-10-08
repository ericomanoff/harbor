import { link } from '../app';
import type { ClusterStore, Pod, Snapshot } from '../store/cluster';

/**
 * A fake three-node cluster that mutates itself, for working on the map
 * without a backend. Enabled with ?demo in the URL.
 */
export function demoSnapshot(): Snapshot {
  const created = new Date().toISOString();
  const node = (name: string, cpu: number, ready = true) => ({
    name, ready, cpuAlloc: cpu, memAlloc: 8 * 1024 ** 3, cpuReq: 450, memReq: 512 * 1024 ** 2, labels: {},
  });
  const dep = (ns: string, name: string, replicas: number, available: number, image: string, extra: Record<string, unknown> = {}) => ({
    ns, name, replicas, available, updated: replicas, image, conditions: [], ...extra,
  });
  const pod = (ns: string, name: string, nodeName: string, deployment: string, extra: Partial<Pod> = {}): Pod => ({
    ns, name, node: nodeName, phase: 'Running', ready: true, restarts: 0, created, deployment, labels: { app: deployment || name }, containers: [deployment || name], ...extra,
  });
  return {
    context: 'demo',
    nodes: [node('harbor-control-plane', 4000), node('harbor-worker', 4000), node('harbor-worker2', 2000, false)],
    namespaces: [
      { name: 'default', phase: 'Active' },
      { name: 'sandbox', phase: 'Active' },
      { name: 'kube-system', phase: 'Active' },
    ],
    deployments: [
      dep('sandbox', 'nginx', 3, 3, 'nginx:1.27-alpine'),
      dep('sandbox', 'crashy', 1, 0, 'busybox:1.36'),
      dep('default', 'api', 2, 1, 'ghcr.io/example/api:2.1', { updated: 1, currentRS: 'api-77' }),
      dep('kube-system', 'coredns', 2, 2, 'coredns:1.11'),
      dep('sandbox', 'outpost-podinfo', 2, 2, 'ghcr.io/stefanprodan/podinfo:6.15.0', { release: 'outpost' }),
      dep('sandbox', 'outpost-redis', 1, 1, 'redis:7', { release: 'outpost' }),
    ],
    releases: [
      { ns: 'sandbox', name: 'outpost', revision: 2, status: 'deployed', chart: 'podinfo', chartVersion: '6.15.0', appVersion: '6.15.0' },
    ],
    workloads: [
      { kind: 'StatefulSet', ns: 'sandbox', name: 'db', image: 'postgres:16', desired: 2, ready: 2, conditions: [] },
      { kind: 'DaemonSet', ns: 'kube-system', name: 'kube-proxy', image: 'kube-proxy', desired: 3, ready: 3, conditions: [] },
      { kind: 'DaemonSet', ns: 'sandbox', name: 'log-agent', image: 'fluent-bit', desired: 3, ready: 2, conditions: [] },
      { kind: 'Job', ns: 'sandbox', name: 'backup', image: 'pg-dump', desired: 2, ready: 1, active: 1, failed: 0, complete: false, conditions: [] },
    ],
    services: [
      { ns: 'sandbox', name: 'nginx', type: 'ClusterIP', clusterIP: '10.96.0.10', ports: [{ port: 80, targetPort: '80', protocol: 'TCP', name: 'http' }], selector: { app: 'nginx' } },
      { ns: 'sandbox', name: 'outpost-podinfo', type: 'LoadBalancer', clusterIP: '10.96.0.20', ports: [{ port: 9898, targetPort: 'http', protocol: 'TCP' }], selector: { app: 'outpost-podinfo' } },
      { ns: 'kube-system', name: 'kube-dns', type: 'ClusterIP', clusterIP: '10.96.0.10', ports: [{ port: 53, targetPort: '53', protocol: 'UDP' }], selector: { app: 'coredns' } },
    ],
    pods: [
      pod('sandbox', 'nginx-7d9-a1', 'harbor-worker', 'nginx'),
      pod('sandbox', 'nginx-7d9-b2', 'harbor-worker', 'nginx'),
      pod('sandbox', 'nginx-7d9-c3', 'harbor-worker2', 'nginx'),
      pod('sandbox', 'crashy-5f-x9', 'harbor-worker', 'crashy', { ready: false, restarts: 7, reason: 'CrashLoopBackOff' }),
      pod('default', 'api-66-p1', 'harbor-control-plane', 'api', { ownerRS: 'api-66' }),
      pod('default', 'api-77-q1', 'harbor-control-plane', 'api', { ownerRS: 'api-77' }),
      pod('default', 'api-66-p2', '', 'api', { phase: 'Pending', ready: false }),
      pod('kube-system', 'coredns-1', 'harbor-control-plane', 'coredns'),
      pod('kube-system', 'coredns-2', 'harbor-control-plane', 'coredns'),
      pod('kube-system', 'kube-proxy-a', 'harbor-worker', ''),
      pod('sandbox', 'outpost-podinfo-1', 'harbor-worker', 'outpost-podinfo'),
      pod('sandbox', 'outpost-podinfo-2', 'harbor-worker2', 'outpost-podinfo'),
      pod('sandbox', 'outpost-redis-1', 'harbor-worker', 'outpost-redis'),
      pod('sandbox', 'db-0', 'harbor-control-plane', '', { ownerKind: 'StatefulSet', ownerName: 'db', labels: { app: 'db' }, containers: ['postgres'] }),
      pod('sandbox', 'db-1', 'harbor-worker', '', { ownerKind: 'StatefulSet', ownerName: 'db', labels: { app: 'db' }, containers: ['postgres'] }),
      pod('sandbox', 'log-agent-a', 'harbor-control-plane', '', { ownerKind: 'DaemonSet', ownerName: 'log-agent' }),
      pod('sandbox', 'log-agent-b', 'harbor-worker', '', { ownerKind: 'DaemonSet', ownerName: 'log-agent' }),
      pod('sandbox', 'log-agent-c', 'harbor-worker2', '', { ownerKind: 'DaemonSet', ownerName: 'log-agent', ready: false }),
      pod('sandbox', 'backup-x1', 'harbor-worker', '', { ownerKind: 'Job', ownerName: 'backup', phase: 'Succeeded', ready: false }),
      pod('sandbox', 'backup-x2', 'harbor-worker2', '', { ownerKind: 'Job', ownerName: 'backup' }),
    ],
  };
}

export function startDemo(store: ClusterStore): () => void {
  store.replace(demoSnapshot());
  link.set('demo');
  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    const name = `nginx-7d9-z${tick}`;
    if (tick % 3 === 1) {
      store.apply({ type: 'modified', kind: 'Pod', obj: { ns: 'sandbox', name, node: '', phase: 'Pending', ready: false, restarts: 0, created: new Date().toISOString(), deployment: 'nginx', labels: { app: 'nginx' }, containers: ['nginx'] } });
    } else if (tick % 3 === 2) {
      store.apply({ type: 'modified', kind: 'Pod', obj: { ns: 'sandbox', name: `nginx-7d9-z${tick - 1}`, node: 'harbor-worker2', phase: 'Running', ready: true, restarts: 0, created: new Date().toISOString(), deployment: 'nginx', labels: { app: 'nginx' }, containers: ['nginx'] } });
    } else {
      store.apply({ type: 'deleted', kind: 'Pod', obj: { ns: 'sandbox', name: `nginx-7d9-z${tick - 2}`, node: 'harbor-worker2', phase: 'Deleted', ready: false, restarts: 0, created: '', labels: {}, containers: [] } });
      store.apply({ type: 'added', kind: 'Event', obj: { ns: 'sandbox', kind: 'Pod', name: 'crashy-5f-x9', type: 'Warning', reason: 'BackOff', message: 'Back-off restarting failed container', ts: new Date().toISOString() } });
    }
  }, 2500);
  return () => clearInterval(timer);
}
