import { describe, expect, it } from 'vitest';
import type { WsMessage } from '../store/cluster';
import { playScript, starsFor, type Scheduler } from './director';

/** A scheduler the test drives by hand. */
function fakeScheduler() {
  const queue: { at: number; fn: () => void; id: number; cancelled: boolean }[] = [];
  let id = 0;
  const s: Scheduler = {
    setTimeout: (fn, ms) => { const h = { at: ms, fn, id: ++id, cancelled: false }; queue.push(h); return h.id; },
    clearTimeout: (h) => { const q = queue.find((x) => x.id === h); if (q) q.cancelled = true; },
  };
  const run = (upTo: number): void => { for (const q of queue.sort((a, b) => a.at - b.at)) if (!q.cancelled && q.at <= upTo) { q.fn(); q.cancelled = true; } };
  return { s, run };
}

const msg = (name: string): WsMessage => ({ type: 'deleted', kind: 'Pod', obj: { ns: 'a', name, node: '', phase: 'Deleted', ready: false, restarts: 0, created: '', labels: {}, containers: [] } });

describe('playScript', () => {
  it('applies messages in time order and can be cancelled', () => {
    const applied: string[] = [];
    const store = { apply: (m: WsMessage) => applied.push((m.obj as { name: string }).name) };
    const { s, run } = fakeScheduler();
    const cancel = playScript(store, [{ at: 500, msg: msg('late') }, { at: 100, msg: msg('early') }], s);
    run(100);
    expect(applied).toEqual(['early']);
    cancel();
    run(1000);
    expect(applied).toEqual(['early']);
  });
});

describe('starsFor', () => {
  it('awards up to three', () => {
    expect(starsFor(10, 0, 60)).toBe(3);
    expect(starsFor(90, 0, 60)).toBe(2);
    expect(starsFor(10, 2, 60)).toBe(2);
    expect(starsFor(90, 1, 60)).toBe(1);
  });
});
