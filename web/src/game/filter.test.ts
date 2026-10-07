import { describe, expect, it } from 'vitest';
import { filterSummary, namespaceVisible } from './filter';

describe('namespace filter', () => {
  const f = { showSystemNamespaces: false, hiddenNamespaces: new Set(['secret']) };
  it('hides system namespaces unless shown, and explicitly hidden ones always', () => {
    expect(namespaceVisible('sandbox', f)).toBe(true);
    expect(namespaceVisible('kube-system', f)).toBe(false);
    expect(namespaceVisible('kube-system', { ...f, showSystemNamespaces: true })).toBe(true);
    expect(namespaceVisible('secret', { ...f, showSystemNamespaces: true })).toBe(false);
  });
  it('summarises', () => {
    expect(filterSummary(['a', 'b'], { showSystemNamespaces: true, hiddenNamespaces: new Set() })).toBe('ALL 2 NS');
    expect(filterSummary(['a', 'kube-system', 'secret'], f)).toBe('2/3 NS HIDDEN');
  });
});
