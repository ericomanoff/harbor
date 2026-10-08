import { beforeEach, describe, expect, it, vi } from 'vitest';
import { better, loadProgress, recordProgress } from './progress';

// Vitest runs in node here; a map-backed localStorage is enough for the mirror.
const mem = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), clear: () => mem.clear() } });

const okJson = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('progress client', () => {
  beforeEach(() => localStorage.clear());

  it('better keeps stars, then time, then hints', () => {
    expect(better(undefined, { stars: 1 }).stars).toBe(1);
    expect(better({ stars: 2, bestSeconds: 50 }, { stars: 2, bestSeconds: 40 }).bestSeconds).toBe(40);
    expect(better({ stars: 3, bestSeconds: 50 }, { stars: 2, bestSeconds: 10 }).stars).toBe(3);
    expect(better({ stars: 2, bestSeconds: 40, hintsUsed: 2 }, { stars: 2, bestSeconds: 40, hintsUsed: 0 }).hintsUsed).toBe(0);
  });

  it('records locally and remotely, and merges on load', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      if (init?.method === 'PUT') return okJson({ levels: {} });
      return okJson({ levels: { 'academy/1': { stars: 3, bestSeconds: 20 } } });
    }) as unknown as typeof fetch;
    await recordProgress('academy/1', { stars: 2, bestSeconds: 30 }, fetchFn);
    await recordProgress('academy/2', { stars: 1, bestSeconds: 99 }, fetchFn);
    expect(calls[0]?.url).toBe('/api/progress/academy%2F1');
    const p = await loadProgress(fetchFn);
    expect(p['academy/1']?.stars).toBe(3);
    expect(p['academy/2']?.stars).toBe(1);
  });

  it('falls back to localStorage when the backend is away', async () => {
    const dead = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await recordProgress('academy/1', { stars: 2 }, dead);
    expect((await loadProgress(dead))['academy/1']?.stars).toBe(2);
  });
});
