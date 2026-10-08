import { describe, expect, it } from 'vitest';
import { segmentTerms } from './markup';
import { TERMS, termFor } from './terms';

describe('segmentTerms', () => {
  it('finds naval and Kubernetes terms as whole words, case-insensitively', () => {
    const segs = segmentTerms('Select the shipyard; a Deployment keeps ships afloat.');
    expect(segs.filter((s) => s.term).map((s) => [s.text, s.term, s.naval])).toEqual([
      ['shipyard', 'shipyard', true],
      ['Deployment', 'shipyard', false],
      ['ships', 'ship', true],
    ]);
  });
  it('prefers the longest phrase and ignores partial words', () => {
    const segs = segmentTerms('The tanker terminal and its tankers; shipyards vs shipyarding.');
    expect(segs.filter((s) => s.term).map((s) => s.text)).toEqual(['tanker terminal', 'tankers', 'shipyards']);
  });
  it('keeps plain text intact around terms', () => {
    const text = 'no terms here at all';
    expect(segmentTerms(text)).toEqual([{ text }]);
    expect(segmentTerms('ship').map((s) => s.text).join('')).toBe('ship');
    expect(segmentTerms('a ship, a gate.').map((s) => s.text).join('')).toBe('a ship, a gate.');
  });
});

describe('glossary coverage', () => {
  const required = {
    naval: ['harbor', 'dock', 'berths', 'cargo', 'crew', 'ship', 'shipyard', 'lighthouse', 'gate', 'anchorage', 'chart', 'chart library', 'ensign', 'tanker terminal', 'tanker', 'tugboat', 'fishing fleet', 'refit', 'scrap', 'launch', 'weigh anchor', 'roll back', "ship's log", 'breakwater', 'quay', 'harbor master', 'training harbor', 'open harbor', 'lookouts', 'sealed orders', 'burning', 'bare hull'],
    k8s: ['cluster', 'node', 'pod', 'container', 'Deployment', 'ReplicaSet', 'Service', 'Ingress', 'TLS', 'namespace', 'label', 'selector', 'StatefulSet', 'DaemonSet', 'Job', 'PersistentVolumeClaim', 'ConfigMap', 'Secret', 'probe', 'rollout', 'release', 'Helm chart', 'Helm repository', 'values', 'CrashLoopBackOff', 'Pending', 'Event', 'request', 'limit', 'context'],
  };
  it('has an entry for every term the UI uses', () => {
    const missing = [...required.naval, ...required.k8s].filter((t) => !termFor(t));
    expect(missing).toEqual([]);
  });
  it('every entry has both a short and a long explanation and unique ids', () => {
    const ids = new Set<string>();
    for (const t of TERMS) {
      expect(t.short.length, t.id).toBeGreaterThan(20);
      expect(t.long.length, t.id).toBeGreaterThan(40);
      expect(ids.has(t.id), t.id).toBe(false);
      ids.add(t.id);
    }
  });
});
