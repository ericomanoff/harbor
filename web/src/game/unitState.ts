import type { Deployment, Pod } from '../store/cluster';

export type UnitState = 'pending' | 'ok' | 'notready' | 'crash' | 'terminating' | 'done';

/** The one state that drives how a pod unit is drawn. */
export function unitState(pod: Pod): UnitState {
  if (pod.phase === 'Terminating') return 'terminating';
  if (pod.phase === 'Succeeded' || pod.phase === 'Failed') return 'done';
  const r = pod.reason ?? '';
  if (/BackOff|Err|OOM|Evicted/i.test(r)) return 'crash';
  if (pod.phase === 'Pending' || !pod.node) return 'pending';
  return pod.ready ? 'ok' : 'notready';
}

/** True when the pod belongs to an older ReplicaSet than its Deployment's current one. */
export function isObsolete(pod: Pod, dep: Deployment | undefined): boolean {
  return !!(dep?.currentRS && pod.ownerRS && pod.ownerRS !== dep.currentRS);
}
