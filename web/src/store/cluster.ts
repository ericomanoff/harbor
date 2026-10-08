import type { components } from '../api/schema';

export type Node = components['schemas']['Node'];
export type Namespace = components['schemas']['Namespace'];
export type Deployment = components['schemas']['Deployment'];
export type Pod = components['schemas']['Pod'];
export type ClusterEvent = components['schemas']['Event'];
export type HelmRelease = components['schemas']['HelmRelease'];
export type Service = components['schemas']['Service'];
export type Workload = components['schemas']['Workload'];
export type Ingress = components['schemas']['Ingress'];

/** Store key for a workload: "Kind:ns/name". */
export const wlKey = (kind: string, ns: string, name: string): string => `${kind}:${ns}/${name}`;
export type Snapshot = components['schemas']['Snapshot'];
export type WsMessage = components['schemas']['WsMessage'];

/** Key for namespaced objects: "ns/name". */
export const nsKey = (ns: string, name: string): string => `${ns}/${name}`;

export type StoreEvent =
  | { type: 'snapshot' }
  | { type: 'node' | 'namespace' | 'deployment' | 'pod' | 'release' | 'service' | 'workload' | 'ingress'; op: 'upsert' | 'delete'; key: string }
  | { type: 'event'; event: ClusterEvent };

const MAX_EVENTS = 100;

/**
 * Client-side mirror of the cluster. Fed by WsMessages; the map and HUD
 * subscribe and re-render. No Phaser in here so it is unit-testable.
 */
export class ClusterStore {
  context = '';
  readonly nodes = new Map<string, Node>();
  readonly namespaces = new Map<string, Namespace>();
  readonly deployments = new Map<string, Deployment>();
  readonly pods = new Map<string, Pod>();
  readonly releases = new Map<string, HelmRelease>();
  readonly services = new Map<string, Service>();
  readonly workloads = new Map<string, Workload>();
  readonly ingresses = new Map<string, Ingress>();
  readonly events: ClusterEvent[] = [];

  private readonly listeners = new Set<(e: StoreEvent) => void>();

  subscribe(fn: (e: StoreEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: StoreEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  /** Replaces all state. Used for the initial snapshot and context switches. */
  replace(snap: Snapshot): void {
    this.context = snap.context;
    this.nodes.clear();
    this.namespaces.clear();
    this.deployments.clear();
    this.pods.clear();
    this.releases.clear();
    this.services.clear();
    this.workloads.clear();
    this.ingresses.clear();
    this.events.length = 0;
    for (const n of snap.nodes) this.nodes.set(n.name, n);
    for (const ns of snap.namespaces) this.namespaces.set(ns.name, ns);
    for (const d of snap.deployments) this.deployments.set(nsKey(d.ns, d.name), d);
    for (const p of snap.pods) this.pods.set(nsKey(p.ns, p.name), p);
    for (const r of snap.releases ?? []) this.releases.set(nsKey(r.ns, r.name), r);
    for (const svc of snap.services ?? []) this.services.set(nsKey(svc.ns, svc.name), svc);
    for (const w of snap.workloads ?? []) this.workloads.set(wlKey(w.kind, w.ns, w.name), w);
    for (const i of snap.ingresses ?? []) this.ingresses.set(nsKey(i.ns, i.name), i);
    this.emit({ type: 'snapshot' });
  }

  /** Applies one stream message. Unknown kinds are ignored. */
  apply(msg: WsMessage): void {
    if (msg.type === 'snapshot') {
      this.replace(msg.obj as Snapshot);
      return;
    }
    const del = msg.type === 'deleted';
    const op = del ? 'delete' : 'upsert';
    switch (msg.kind) {
      case 'Node': {
        const n = msg.obj as Node;
        if (del) this.nodes.delete(n.name);
        else this.nodes.set(n.name, n);
        this.emit({ type: 'node', op, key: n.name });
        break;
      }
      case 'Namespace': {
        const ns = msg.obj as Namespace;
        if (del) this.namespaces.delete(ns.name);
        else this.namespaces.set(ns.name, ns);
        this.emit({ type: 'namespace', op, key: ns.name });
        break;
      }
      case 'Deployment': {
        const d = msg.obj as Deployment;
        const key = nsKey(d.ns, d.name);
        if (del) this.deployments.delete(key);
        else this.deployments.set(key, d);
        this.emit({ type: 'deployment', op, key });
        break;
      }
      case 'Pod': {
        const p = msg.obj as Pod;
        const key = nsKey(p.ns, p.name);
        if (del) this.pods.delete(key);
        else this.pods.set(key, p);
        this.emit({ type: 'pod', op, key });
        break;
      }
      case 'Service': {
        const svc = msg.obj as Service;
        const key = nsKey(svc.ns, svc.name);
        if (del) this.services.delete(key);
        else this.services.set(key, svc);
        this.emit({ type: 'service', op, key });
        break;
      }
      case 'Workload': {
        const w = msg.obj as Workload;
        const key = wlKey(w.kind, w.ns, w.name);
        if (del) this.workloads.delete(key);
        else this.workloads.set(key, w);
        this.emit({ type: 'workload', op, key });
        break;
      }
      case 'Ingress': {
        const i = msg.obj as Ingress;
        const key = nsKey(i.ns, i.name);
        if (del) this.ingresses.delete(key);
        else this.ingresses.set(key, i);
        this.emit({ type: 'ingress', op, key });
        break;
      }
      case 'HelmRelease': {
        const r = msg.obj as HelmRelease;
        const key = nsKey(r.ns, r.name);
        if (del) this.releases.delete(key);
        else this.releases.set(key, r);
        this.emit({ type: 'release', op, key });
        break;
      }
      case 'Event': {
        const ev = msg.obj as ClusterEvent;
        this.events.push(ev);
        if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
        this.emit({ type: 'event', event: ev });
        break;
      }
      default:
        break;
    }
  }
}
