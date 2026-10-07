import { describe, expect, it } from 'vitest';
import { voiceLineFor } from './voice';

describe('voiceLineFor', () => {
  it('maps the fixed EVA vocabulary and never reads names', () => {
    expect(voiceLineFor('CONSTRUCTION COMPLETE: radar')).toBe('Construction complete');
    expect(voiceLineFor('UNIT DEPLOYED: nginx-7d9-x')).toBe('Unit ready');
    expect(voiceLineFor('UNITS SOLD')).toBe('Unit sold');
    expect(voiceLineFor('UNABLE TO COMPLY: 404')).toBe('Unable to comply');
    expect(voiceLineFor('BackOff: crashy-1')).toBe('Unit under attack');
    expect(voiceLineFor('INSUFFICIENT POWER')).toBe('Insufficient power');
  });
  it('stays silent for lines without a voice', () => {
    expect(voiceLineFor('UNIT ORDERED: x')).toBe('Training');
    expect(voiceLineFor('Pulled: nginx-1')).toBeUndefined();
    expect(voiceLineFor('')).toBeUndefined();
  });
});
