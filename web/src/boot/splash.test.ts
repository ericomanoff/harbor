import { describe, expect, it } from 'vitest';
import { STAGE_PROGRESS, Splash, TIPS, nextTip, stageLine } from './splash';

describe('stageLine', () => {
  it('speaks harbor for every stage', () => {
    expect(stageLine('assets')).toBe('Loading the charts…');
    expect(stageLine('fonts')).toBe('Hoisting the flags…');
    expect(stageLine('backend')).toBe('Hailing the harbor master…');
    expect(stageLine('backend', 'kind-harbor')).toBe('Hailing kind-harbor…');
    expect(stageLine('sail')).toBe('Sailing in…');
  });
  it('progress rises stage by stage to 1', () => {
    expect(STAGE_PROGRESS.assets).toBeLessThan(STAGE_PROGRESS.fonts);
    expect(STAGE_PROGRESS.fonts).toBeLessThan(STAGE_PROGRESS.backend);
    expect(STAGE_PROGRESS.sail).toBe(1);
  });
});

describe('tips', () => {
  it('cycle without repeating consecutively and cover every tip', () => {
    const seen = new Set<number>();
    let i = -1;
    for (let n = 0; n < TIPS.length; n++) {
      const next = nextTip(i);
      expect(next).not.toBe(i);
      seen.add(next);
      i = next;
    }
    expect(seen.size).toBe(TIPS.length);
    expect(nextTip(0, 1)).toBe(0);
  });
});

describe('Splash without a DOM', () => {
  it('is inert and resolves done immediately', async () => {
    const s = new Splash(null);
    s.setStage('backend', 'x');
    s.setProgress(0.5);
    s.fail('nope', { onRetry: () => {}, onDemo: () => {} });
    await expect(s.done()).resolves.toBeUndefined();
  });
});
