import type { ClusterStore, StoreEvent } from '../store/cluster';

/**
 * Turns store events into EVA announcements. Keeps enough memory (what has
 * been seen, each factory's availability) to tell "new" from "changed".
 */
export class EvaFeed {
  private readonly seenDeps = new Set<string>();
  private readonly seenPods = new Set<string>();
  private readonly avail = new Map<string, number>();
  private readonly relStatus = new Map<string, string>();

  constructor(private readonly store: ClusterStore) {}

  /** Lines to announce for this event; usually zero or one. */
  announce(e: StoreEvent): string[] {
    const s = this.store;
    switch (e.type) {
      case 'snapshot': {
        this.seenDeps.clear();
        this.seenPods.clear();
        this.avail.clear();
        for (const [k, d] of s.deployments) {
          this.seenDeps.add(k);
          this.avail.set(k, d.available);
        }
        for (const k of s.pods.keys()) this.seenPods.add(k);
        this.relStatus.clear();
        for (const [k, r] of s.releases) this.relStatus.set(k, r.status);
        return s.context ? ['BATTLEFIELD CONTROL ESTABLISHED'] : [];
      }
      case 'deployment': {
        const d = s.deployments.get(e.key);
        if (e.op === 'delete') {
          this.seenDeps.delete(e.key);
          this.avail.delete(e.key);
          return [`STRUCTURE SOLD: ${e.key}`];
        }
        if (!d) return [];
        const prev = this.avail.get(e.key);
        this.avail.set(e.key, d.available);
        if (!this.seenDeps.has(e.key)) {
          this.seenDeps.add(e.key);
          return [`NEW CONSTRUCTION: ${e.key}`];
        }
        if (prev === 0 && d.available > 0) return [`CONSTRUCTION COMPLETE: ${d.name}`];
        return [];
      }
      case 'pod': {
        const name = e.key.split('/')[1] ?? e.key;
        if (e.op === 'delete') {
          this.seenPods.delete(e.key);
          return [`UNIT LOST: ${name}`];
        }
        if (this.seenPods.has(e.key)) return [];
        this.seenPods.add(e.key);
        return [`UNIT DEPLOYED: ${name}`];
      }
      case 'release': {
        const name = e.key.split('/')[1] ?? e.key;
        if (e.op === 'delete') {
          this.relStatus.delete(e.key);
          return [`EXPANSION DISMANTLED: ${name}`];
        }
        const r = s.releases.get(e.key);
        if (!r) return [];
        const prev = this.relStatus.get(e.key);
        this.relStatus.set(e.key, r.status);
        if (prev === undefined) return [`BASE EXPANSION: ${name}`];
        if (prev === r.status) return [];
        if (r.status === 'failed') return [`EXPANSION FAILED: ${name}`];
        if (r.status === 'deployed') return [`EXPANSION ONLINE: ${name} rev ${r.revision}`];
        return [];
      }
      case 'event':
        return e.event.type === 'Warning' ? [`${e.event.reason}: ${e.event.name}`] : [];
      default:
        return [];
    }
  }
}

/** Clips a line for the sidebar log. */
export function clipLine(line: string, max = 30): string {
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
