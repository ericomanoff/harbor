import { describe, expect, it } from 'vitest';
import { snapFacing } from './sprites';

describe('snapFacing', () => {
  it('snaps to the eight compass directions', () => {
    expect(snapFacing(1, 0)).toBeCloseTo(0);
    expect(snapFacing(1, 0.3)).toBeCloseTo(0);
    expect(snapFacing(1, 1)).toBeCloseTo(Math.PI / 4);
    expect(snapFacing(0, 1)).toBeCloseTo(Math.PI / 2);
    expect(snapFacing(-1, 0)).toBeCloseTo(Math.PI);
    expect(snapFacing(-1, -1)).toBeCloseTo(-3 * Math.PI / 4);
    expect(snapFacing(0.2, -1)).toBeCloseTo(-Math.PI / 2);
  });
});
