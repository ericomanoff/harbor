import { describe, expect, it } from 'vitest';
import { ClusterStore } from '../../store/cluster';
import { termById } from '../../glossary/terms';
import { ACADEMY, levelById, nextLevel } from './index';

describe('academy levels', () => {
  it('are numbered in order with glossary-backed terms and loadable fixtures', () => {
    ACADEMY.forEach((l, i) => {
      expect(l.number).toBe(i + 1);
      for (const t of l.terms) expect(termById(t), `${l.id} term ${t}`).toBeDefined();
      const store = new ClusterStore();
      store.replace(l.fixture());
      expect(store.nodes.size).toBeGreaterThan(0);
      const steps = l.steps({ store, play: () => () => {}, simulate: () => undefined });
      expect(steps.length).toBeGreaterThan(3);
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      const sum = l.summary(store);
      expect(sum.naval.length).toBeGreaterThan(20);
      expect(sum.manifest).toContain('kind:');
    });
  });
  it('links levels', () => {
    expect(levelById('academy/1')?.title).toBe('A ship and its cargo');
    expect(nextLevel('academy/1')?.id).toBe('academy/2');
    expect(nextLevel('academy/2')?.id).toBe('academy/3');
    expect(nextLevel('academy/5')).toBeUndefined();
  });
});
