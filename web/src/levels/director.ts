import type { ClusterStore } from '../store/cluster';
import type { ScriptedMessage } from './types';

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Plays a scripted sequence of stream messages into the store. The script
 * is sorted by offset; cancelling stops anything not yet applied.
 */
export function playScript(store: Pick<ClusterStore, 'apply'>, script: ScriptedMessage[], sched: Scheduler = realScheduler): () => void {
  const handles: unknown[] = [];
  for (const { at, msg } of [...script].sort((a, b) => a.at - b.at)) {
    handles.push(sched.setTimeout(() => store.apply(msg), Math.max(0, at)));
  }
  return () => {
    for (const h of handles) sched.clearTimeout(h);
  };
}

/** Stars: finishing earns one, no hints a second, beating par a third. */
export function starsFor(seconds: number, hintsUsed: number, parSeconds: number): number {
  return 1 + (hintsUsed === 0 ? 1 : 0) + (seconds <= parSeconds ? 1 : 0);
}
