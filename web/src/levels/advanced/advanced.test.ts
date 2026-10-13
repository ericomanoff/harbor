import { describe, expect, it } from 'vitest';
import { ClusterStore } from '../../store/cluster';
import { termById } from '../../glossary/terms';
import { ADVANCED, levelById, nextLevel } from './index';

describe('advanced levels', () => {
  it('are numbered in order with glossary-backed terms and loadable fixtures', () => {
    ADVANCED.forEach((l, i) => {
      expect(l.number).toBe(i + 1);
      for (const t of l.terms) expect(termById(t), `${l.id} term ${t}`).toBeDefined();
      const store = new ClusterStore();
      store.replace(l.fixture());
      expect(store.nodes.size).toBeGreaterThan(0);
      const steps = l.steps({ store, mode: 'sim', ns: 'harbor', play: () => () => {}, simulate: () => undefined, sink: () => undefined, stage: async () => undefined, orders: () => [] });
      expect(steps.length).toBeGreaterThan(3);
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      const sum = l.summary(store);
      expect(sum.naval.length).toBeGreaterThan(20);
      expect(sum.manifest).toContain('kind:');
    });
  });
  it('links levels', () => {
    expect(levelById('advanced/1')?.title).toBe('A ship and its cargo');
    expect(nextLevel('advanced/1')?.id).toBe('advanced/2');
    expect(nextLevel('advanced/2')?.id).toBe('advanced/3');
    expect(nextLevel('advanced/5')?.id).toBe('advanced/6');
    expect(nextLevel('advanced/8')?.id).toBe('advanced/9');
    expect(nextLevel('advanced/10')).toBeUndefined();
  });
});
