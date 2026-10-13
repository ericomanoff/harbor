import { Emitter } from '../app';

/**
 * The ledger: every write the harbor made to the API server and every
 * change the stream delivered, with who caused it. On a real cluster the
 * actor comes from the object's field managers; in the training harbor the
 * simulator stamps it.
 */
export interface LedgerEntry {
  t: Date;
  /** Who wrote: you, the Deployment controller, the scheduler, the kubelet, Helm, … */
  who: string;
  /** What: "POST /api/deployments" or "Pod courier-a changed". */
  what: string;
  kind?: string;
  name?: string;
  /** Request (a write you made) or observation (a change that arrived). */
  dir: 'request' | 'change';
}

const MAX = 400;

export class Ledger {
  readonly entries: LedgerEntry[] = [];
  readonly changed = new Emitter<LedgerEntry>();
  /** The actor to stamp on the next stream changes when no manager says otherwise (set by the simulator). */
  actor = 'the cluster';

  add(e: Omit<LedgerEntry, 't'>): void {
    const entry = { t: new Date(), ...e };
    this.entries.push(entry);
    if (this.entries.length > MAX) this.entries.splice(0, this.entries.length - MAX);
    this.changed.emit(entry);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export const ledger = new Ledger();

/** The friendly name of a Kubernetes field manager. */
export function actorName(manager: string | undefined): string {
  if (!manager) return 'the cluster';
  const m = manager.toLowerCase();
  if (m === 'harbor') return 'you';
  if (m.startsWith('kubectl')) return 'kubectl';
  if (m === 'kube-controller-manager' || m === 'deployment-controller' || m === 'replicaset-controller') return 'a controller';
  if (m === 'kube-scheduler') return 'the scheduler';
  if (m === 'kubelet') return 'the kubelet';
  if (m === 'helm') return 'Helm';
  return manager;
}

/** Describes a stream change for the ledger. */
export function describeChange(kind: string, name: string, op: 'upsert' | 'delete'): string {
  return `${kind} ${name} ${op === 'delete' ? 'deleted' : 'changed'}`;
}
