import type { ClusterStore } from '../store/cluster';

/** A shipyard (Deployment) in the namespace has at least one ship moored and ready. */
export function shipyardAfloat(store: Pick<ClusterStore, 'deployments' | 'pods'>, ns: string): string | undefined {
  for (const d of store.deployments.values()) {
    if (d.ns !== ns || d.replicas < 1) continue;
    const ready = [...store.pods.values()].filter((p) => p.ns === ns && p.deployment === d.name && p.ready).length;
    if (ready >= 1 && d.available >= 1) return d.name;
  }
  return undefined;
}

/** The named pod is gone from the store. */
export function podGone(store: Pick<ClusterStore, 'pods'>, key: string): boolean {
  return !store.pods.has(key);
}

/** A ship of the shipyard other than the sunk one is ready: the relaunch landed. */
export function relaunched(store: Pick<ClusterStore, 'pods'>, ns: string, deployment: string, sunk: string): boolean {
  return [...store.pods.values()].some((p) => p.ns === ns && p.deployment === deployment && p.name !== sunk && p.ready) && !store.pods.has(`${ns}/${sunk}`);
}

/** Ready ships of a shipyard. */
export function readyShips(store: Pick<ClusterStore, 'pods'>, ns: string, deployment: string): number {
  return [...store.pods.values()].filter((p) => p.ns === ns && p.deployment === deployment && p.ready).length;
}

/** A shipyard in the namespace with both lookouts set and at least one ready ship. */
export function lookoutsShipyard(store: Pick<ClusterStore, 'deployments' | 'pods'>, ns: string): string | undefined {
  for (const d of store.deployments.values()) {
    if (d.ns === ns && d.readiness && d.liveness && readyShips(store, ns, d.name) >= 1) return d.name;
  }
  return undefined;
}

/** A lighthouse in the namespace whose beam reaches the shipyard's ships (selector matches their labels). */
export function lighthouseFor(store: Pick<ClusterStore, 'services' | 'pods'>, ns: string, deployment: string): string | undefined {
  const ships = [...store.pods.values()].filter((p) => p.ns === ns && p.deployment === deployment);
  if (ships.length === 0) return undefined;
  for (const s of store.services.values()) {
    const keys = Object.keys(s.selector);
    if (s.ns === ns && keys.length > 0 && s.ports.length > 0 && ships.every((p) => keys.every((k) => p.labels[k] === s.selector[k]))) return s.name;
  }
  return undefined;
}
