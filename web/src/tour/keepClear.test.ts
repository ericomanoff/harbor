import { describe, expect, it } from 'vitest';
import { keepClear } from './keepClear';

describe('keepClear', () => {
  it('slides the column left by the overlap plus the gap', () => {
    expect(keepClear({ left: 500, right: 880 }, 700, 806, 260, false)).toEqual({ shift: 196, fold: false });
    expect(keepClear({ left: 400, right: 600 }, 700, 806, 260, false)).toEqual({ shift: 0, fold: false });
  });
  it('folds the bubble when the column cannot move far enough, with hysteresis', () => {
    expect(keepClear({ left: 300, right: 900 }, 700, 806, 260, false)).toEqual({ shift: 24, fold: true });
    // Once folded, it stays folded until there is clearly room again.
    expect(keepClear({ left: 500, right: 880 }, 700, 806, 260, true)).toEqual({ shift: 90, fold: true });
    expect(keepClear({ left: 500, right: 800 }, 700, 806, 260, true)).toEqual({ shift: 116, fold: false });
  });
  it('does nothing for an empty column', () => {
    expect(keepClear({ left: 0, right: 0 }, 700, 806, 260, false)).toEqual({ shift: 0, fold: false });
  });
});
