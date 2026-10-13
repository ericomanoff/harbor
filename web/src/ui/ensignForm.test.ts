import { describe, expect, it } from 'vitest';
import { labelPatch } from './ensignForm';

describe('labelPatch', () => {
  it('sets changed keys and removes missing ones', () => {
    expect(labelPatch({ app: 'a', tier: 'web' }, { app: 'a', track: 'canary' })).toEqual({ set: { track: 'canary' }, remove: ['tier'] });
    expect(labelPatch({ app: 'a' }, { app: 'a' })).toEqual({});
  });
});
