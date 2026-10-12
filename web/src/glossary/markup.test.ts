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
  it('every entry explains the concept first, has a use case when it is a Kubernetes term, maps to the harbor, and ids are unique', () => {
    const ids = new Set<string>();
    // Game nouns a Kubernetes explanation must not lean on ("chart" is Helm's own word; "ships" the verb is fine).
    const harborWords = /\b(shipyard|lighthouse|harbor|island|dock|anchorage|tanker|tugboat|ensign|beam|crate|berth)s?\b|\b(a|the|lone|new|old|every|each) ships?\b/i;
    for (const t of TERMS) {
      expect(t.concept.length, t.id).toBeGreaterThan(40);
      expect(t.inHarbor.length, t.id).toBeGreaterThan(10);
      if (t.k8s.length) {
        expect(t.useCase?.length ?? 0, `${t.id} needs a use case`).toBeGreaterThan(20);
        expect(harborWords.test(t.concept), `${t.id} concept mentions the game: ${t.concept}`).toBe(false);
      }
      expect(ids.has(t.id), t.id).toBe(false);
      ids.add(t.id);
    }
  });
});
