import { describe, expect, it } from 'vitest';
import { FACTION_PALETTE, hexString, isSystemNamespace, namespaceColor } from './colors';

describe('colors', () => {
  it('namespace colour is stable and from the palette', () => {
    expect(namespaceColor('sandbox')).toBe(namespaceColor('sandbox'));
    expect(FACTION_PALETTE).toContain(namespaceColor('sandbox'));
  });
  it('flags system namespaces', () => {
    expect(isSystemNamespace('kube-system')).toBe(true);
    expect(isSystemNamespace('local-path-storage')).toBe(true);
    expect(isSystemNamespace('sandbox')).toBe(false);
  });
  it('formats hex', () => {
    expect(hexString(0x00ff14)).toBe('#00ff14');
  });
});
