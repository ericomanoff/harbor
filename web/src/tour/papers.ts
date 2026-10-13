import { dump } from 'js-yaml';
import type { ClusterStore, Deployment, Pod, Service } from '../store/cluster';

/** A plausible pod IP for the training harbor, stable per pod name. */
export function fakeIP(name: string): string {
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `10.244.${(h >> 8) % 4}.${(h % 250) + 2}`;
}

const y = (v: unknown): string => dump(v, { noRefs: true, lineWidth: 120 }).trimEnd();

/** Spec and status documents the simulator would report for an object. */
export function simulatedPapers(store: ClusterStore, kind: string, ns: string, name: string): { kind: string; ns: string; name: string; metadata: string; spec: string; status: string; managers: string[] } | undefined {
  const base = (meta: Record<string, unknown>, spec: unknown, status: unknown, managers: string[]) => ({ kind, ns, name, metadata: y(meta), spec: spec ? y(spec) : '', status: status ? y(status) : '', managers });
  if (kind === 'Deployment') {
    const d = store.deployments.get(`${ns}/${name}`);
    if (!d) return undefined;
    const ready = [...store.pods.values()].filter((p) => p.ns === ns && p.deployment === name && p.ready).length;
    const total = [...store.pods.values()].filter((p) => p.ns === ns && p.deployment === name).length;
    const [cpu, mem] = [/cpu (\S+)/.exec(d.requests ?? '')?.[1] ?? '50m', /mem (\S+)/.exec(d.requests ?? '')?.[1] ?? '64Mi'];
    const container: Record<string, unknown> = { name, image: d.image, resources: { requests: { cpu, memory: mem } } };
    if (d.limits) container['resources'] = { ...(container['resources'] as object), limits: { cpu: /cpu (\S+)/.exec(d.limits)?.[1], memory: /mem (\S+)/.exec(d.limits)?.[1] } };
    if (d.readiness) container['readinessProbe'] = { httpGet: { path: d.readiness.replace(/^http /, ''), port: 80 } };
    if (d.liveness) container['livenessProbe'] = { httpGet: { path: d.liveness.replace(/^http /, ''), port: 80 } };
    return base(
      { labels: { app: name }, annotations: { 'deployment.kubernetes.io/revision': String(d.revision ?? 1) }, generation: d.revision ?? 1 },
      { replicas: d.replicas, selector: { matchLabels: { app: name } }, strategy: d.strategy?.startsWith('Recreate') ? { type: 'Recreate' } : { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: /maxUnavailable=(\S+)/.exec(d.strategy ?? '')?.[1] ?? '25%', maxSurge: /maxSurge=(\S+)/.exec(d.strategy ?? '')?.[1] ?? '25%' } }, template: { metadata: { labels: { app: name, ...(d.templateLabels ?? {}) } }, spec: { containers: [container] } } },
      { observedGeneration: d.revision ?? 1, replicas: total, updatedReplicas: d.updated, readyReplicas: ready, availableReplicas: d.available, conditions: [{ type: 'Available', status: d.available >= 1 ? 'True' : 'False' }] },
      ['harbor', 'kube-controller-manager'],
    );
  }
  if (kind === 'Pod') {
    const p: Pod | undefined = store.pods.get(`${ns}/${name}`);
    if (!p) return undefined;
    const owner = p.ownerRS ? [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: p.ownerRS, controller: true }] : p.ownerKind ? [{ apiVersion: 'apps/v1', kind: p.ownerKind, name: p.ownerName, controller: true }] : undefined;
    return base(
      { labels: p.labels, creationTimestamp: p.created, ...(owner ? { ownerReferences: owner } : {}) },
      { ...(p.node ? { nodeName: p.node } : {}), containers: p.containers.map((c) => ({ name: c, image: store.deployments.get(`${ns}/${p.deployment ?? ''}`)?.image ?? 'unknown' })), restartPolicy: 'Always' },
      { phase: p.phase, ...(p.node ? { hostIP: fakeIP(p.node), podIP: fakeIP(p.name) } : {}), conditions: [{ type: 'PodScheduled', status: p.node ? 'True' : 'False' }, { type: 'Ready', status: p.ready ? 'True' : 'False' }], containerStatuses: p.containers.map((c) => ({ name: c, ready: p.ready, restartCount: p.restarts, ...(p.reason ? { state: { waiting: { reason: p.reason } } } : {}) })) },
      p.deployment ? ['kube-controller-manager', 'kube-scheduler', 'kubelet'] : ['harbor', 'kube-scheduler', 'kubelet'],
    );
  }
  if (kind === 'Service') {
    const sv: Service | undefined = store.services.get(`${ns}/${name}`);
    if (!sv) return undefined;
    return base({ labels: {} }, { type: sv.type, clusterIP: sv.clusterIP, selector: sv.selector, ports: sv.ports.map((pt) => ({ port: pt.port, targetPort: Number(pt.targetPort) || pt.targetPort, protocol: pt.protocol, ...(pt.name ? { name: pt.name } : {}) })) }, { loadBalancer: {} }, ['harbor']);
  }
  if (kind === 'Ingress') {
    const ing = store.ingresses.get(`${ns}/${name}`);
    if (!ing) return undefined;
    return base({ labels: {} }, { ...(ing.class ? { ingressClassName: ing.class } : {}), rules: ing.rules.map((r) => ({ ...(r.host ? { host: r.host } : {}), http: { paths: [{ path: r.path || '/', pathType: 'Prefix', backend: { service: { name: r.service, port: { number: Number(r.port) || undefined, name: Number(r.port) ? undefined : r.port } } } }] } })) }, { loadBalancer: { ingress: ing.addresses.map((ip) => ({ ip })) } }, ['harbor']);
  }
  if (kind === 'Namespace') {
    const n = store.namespaces.get(name);
    if (!n) return undefined;
    return base({ labels: { 'kubernetes.io/metadata.name': name } }, { finalizers: ['kubernetes'] }, { phase: n.phase }, ['harbor']);
  }
  return undefined;
}

/** The current spec of an object as the simulator sees it, for apply diffs. */
export function simulatedSpecYaml(store: ClusterStore, kind: string, ns: string, name: string): string | undefined {
  return simulatedPapers(store, kind, ns, name)?.spec;
}

export type { Deployment };
