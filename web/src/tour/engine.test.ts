import { describe, expect, it } from 'vitest';
import { TourEngine, type TourStep } from './engine';

function make(steps: TourStep[]) {
  const seen: string[] = [];
  let finished = '';
  const e = new TourEngine(steps, { onStep: (s) => seen.push(s.id), onFinish: (r) => { finished = r; } });
  return { e, seen, finished: () => finished };
}

describe('TourEngine', () => {
  it('walks forward and back and completes at the end', () => {
    const { e, seen, finished } = make([{ id: 'a', title: '', text: '' }, { id: 'b', title: '', text: '' }]);
    e.start();
    e.next();
    e.back();
    e.next();
    e.next();
    expect(seen).toEqual(['a', 'b', 'a', 'b']);
    expect(finished()).toBe('completed');
    expect(e.finished).toBe(true);
  });

  it('skip finishes early and runs onLeave once', () => {
    let left = 0;
    const { e, finished } = make([{ id: 'a', title: '', text: '', onLeave: () => { left++; } }, { id: 'b', title: '', text: '' }]);
    e.start();
    e.skip();
    e.skip();
    expect(finished()).toBe('skipped');
    expect(left).toBe(1);
  });

  it('interactive steps advance from tick only when their condition holds', () => {
    let done = false;
    const { e, seen } = make([{ id: 'a', title: '', text: '', waitFor: () => done }, { id: 'b', title: '', text: '' }]);
    e.start();
    e.tick();
    expect(seen).toEqual(['a']);
    done = true;
    e.tick();
    expect(seen).toEqual(['a', 'b']);
    e.tick(); // b has no waitFor: nothing happens
    expect(e.finished).toBe(false);
  });

  it('runs onEnter/onLeave hooks in order', () => {
    const log: string[] = [];
    const { e } = make([
      { id: 'a', title: '', text: '', onEnter: () => log.push('enter a'), onLeave: () => log.push('leave a') },
      { id: 'b', title: '', text: '', onEnter: () => log.push('enter b'), onLeave: () => log.push('leave b') },
    ]);
    e.start();
    e.next();
    e.next();
    expect(log).toEqual(['enter a', 'leave a', 'enter b', 'leave b']);
  });

  it('an empty tour completes immediately', () => {
    const { e, finished } = make([]);
    e.start();
    expect(finished()).toBe('completed');
  });
});
