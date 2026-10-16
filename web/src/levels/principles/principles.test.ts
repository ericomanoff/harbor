import { describe, expect, it } from 'vitest';
import { termById } from '../../glossary/terms';
import { ClusterStore } from '../../store/cluster';
import { PRINCIPLES } from './index';

describe('1st Principles levels', () => {
  it('are numbered, glossary-backed, loadable and summarised', () => {
    PRINCIPLES.forEach((l, i) => {
      expect(l.number).toBe(i + 1);
      expect(l.id).toBe(`principles/${i + 1}`);
      for (const t of l.terms) expect(termById(t), `${l.id} term ${t}`).toBeDefined();
      const store = new ClusterStore();
      store.replace(l.fixture());
      const steps = l.steps({ store, mode: 'sim', ns: 'harbor', play: () => () => {}, simulate: () => undefined, sink: () => undefined, stage: async () => undefined, orders: () => [] });
      expect(steps.length).toBeGreaterThan(4);
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      const sum = l.summary(store);
      expect(sum.kubernetes.length).toBeGreaterThan(80);
      expect(sum.devops.length).toBeGreaterThan(80);
    });
  });
});
