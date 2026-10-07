import type { Deployment, Pod } from '../store/cluster';
import { nsKey } from '../store/cluster';

export interface SellGroup {
  ns: string;
  deployment: string;
  /** Pods to retire, in selection order. */
  names: string[];
  /** Replica count to scale the Deployment to. */
  target: number;
}

export interface SellPlan {
  /** False when any selected pod has no owning Deployment. */
  sellable: boolean;
  groups: SellGroup[];
}

/**
 * Turns a unit selection into one scale call per owning Deployment, each
 * retiring exactly the selected pods. Pods without a factory cannot be sold
 * (deleting them would just make their DaemonSet or static-pod owner respawn
 * them, which is "repair", not "sell").
 */
export function sellPlan(pods: Pod[], deployments: ReadonlyMap<string, Deployment>): SellPlan {
  const groups = new Map<string, SellGroup>();
  for (const p of pods) {
    if (!p.deployment) return { sellable: false, groups: [] };
    const key = nsKey(p.ns, p.deployment);
    const dep = deployments.get(key);
    if (!dep) return { sellable: false, groups: [] };
    const g = groups.get(key) ?? { ns: p.ns, deployment: p.deployment, names: [], target: dep.replicas };
    g.names.push(p.name);
    g.target = Math.max(0, dep.replicas - g.names.length);
    groups.set(key, g);
  }
  return { sellable: pods.length > 0, groups: [...groups.values()] };
}
