import { describe, expect, it } from 'vitest';
import { refitYaml } from './refitForm';

describe('refitYaml', () => {
  it('shows the strategy only when asked for', () => {
    const plain = refitYaml({ ns: 'harbor', name: 'courier' }, { image: 'courier:2.1' });
    expect(plain).toContain('image: courier:2.1');
    expect(plain).not.toContain('strategy');
    const safe = refitYaml({ ns: 'harbor', name: 'courier' }, { image: 'courier:2.1', maxUnavailable: '0', maxSurge: '1' });
    expect(safe).toContain('maxUnavailable: 0');
    expect(safe).toContain('maxSurge: 1');
  });
});
