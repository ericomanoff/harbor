import { describe, expect, it } from 'vitest';
import { missingValues, valuesSkeleton } from './techTree';

describe('expedition values', () => {
  it('builds a nested skeleton and finds unset required keys', () => {
    const sk = valuesSkeleton(['image.repository', 'image.tag', 'gpu.enabled']);
    expect(sk).toContain('image:\n  repository: \n  tag: \ngpu:\n  enabled: ');
    expect(missingValues(sk, ['image.repository', 'image.tag', 'gpu.enabled'])).toEqual(['image.repository', 'image.tag', 'gpu.enabled']);
    const filled = 'image:\n  repository: reg/fortiaigate\n  tag: "8.0.1"\ngpu:\n  enabled: true\n';
    expect(missingValues(filled, ['image.repository', 'image.tag', 'gpu.enabled', 'ingress.host'])).toEqual(['ingress.host']);
  });
});
