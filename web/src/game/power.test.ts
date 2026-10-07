import { describe, expect, it } from 'vitest';
import type { Node } from '../store/cluster';
import { computePower, formatPower } from './power';

const node = (cpuReq: number, cpuAlloc: number, ready = true): Node => ({ name: 'n', ready, cpuAlloc, memAlloc: 0, cpuReq, memReq: 0, labels: {} });

describe('computePower', () => {
  it('sums ready nodes only and grades the fraction', () => {
    const p = computePower([node(1000, 4000), node(2000, 4000), node(9000, 4000, false)]);
    expect(p).toMatchObject({ req: 3000, alloc: 8000, level: 'ok' });
    expect(p.frac).toBeCloseTo(0.375);
    expect(computePower([node(7000, 10000)]).level).toBe('low');
    expect(computePower([node(9000, 10000)]).level).toBe('critical');
  });
  it('handles an empty cluster', () => {
    expect(computePower([])).toEqual({ req: 0, alloc: 0, frac: 0, level: 'ok' });
    expect(formatPower(computePower([]))).toBe('no power');
  });
  it('formats as a percentage and cores', () => {
    expect(formatPower(computePower([node(1500, 24000)]))).toBe('6%  1.5/24 cpu');
  });
});
