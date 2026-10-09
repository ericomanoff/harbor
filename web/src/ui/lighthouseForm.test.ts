import { describe, expect, it } from 'vitest';
import { parseLabels } from './lighthouseForm';

describe('parseLabels', () => {
  it('parses key=value pairs and drops empties', () => {
    expect(parseLabels('app=courier, tier=web,,bad,novalue=')).toEqual({ app: 'courier', tier: 'web' });
    expect(parseLabels('')).toEqual({});
  });
});
