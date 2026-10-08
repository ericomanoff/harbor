import type { components } from '../api/schema';

export type LevelProgress = components['schemas']['LevelProgress'];
export type ProgressMap = Record<string, LevelProgress>;

const LOCAL_KEY = 'harbor.progress.v1';

const readLocal = (): ProgressMap => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as ProgressMap;
  } catch {
    return {};
  }
};
const writeLocal = (p: ProgressMap): void => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
};

/** Keeps the best of two records: most stars, then fastest, then fewest hints. */
export function better(a: LevelProgress | undefined, b: LevelProgress): LevelProgress {
  if (!a) return b;
  if (b.stars !== a.stars) return b.stars > a.stars ? b : a;
  const ta = a.bestSeconds ?? Infinity;
  const tb = b.bestSeconds ?? Infinity;
  if (tb !== ta) return tb < ta ? b : a;
  return (b.hintsUsed ?? 0) < (a.hintsUsed ?? 0) ? b : a;
}

/**
 * Progress lives in the backend (~/.config/harbor/progress.json) and is
 * mirrored in localStorage so the demo harbor without a backend still
 * remembers stars. Reads merge both, keeping the best.
 */
export async function loadProgress(fetchFn: typeof fetch = fetch): Promise<ProgressMap> {
  const local = readLocal();
  try {
    const res = await fetchFn('/api/progress');
    if (!res.ok) return local;
    const remote = ((await res.json()) as { levels?: ProgressMap }).levels ?? {};
    const merged: ProgressMap = { ...local };
    for (const [k, v] of Object.entries(remote)) merged[k] = better(merged[k], v);
    return merged;
  } catch {
    return local;
  }
}

export async function recordProgress(level: string, p: LevelProgress, fetchFn: typeof fetch = fetch): Promise<void> {
  const local = readLocal();
  local[level] = better(local[level], p);
  writeLocal(local);
  try {
    await fetchFn(`/api/progress/${encodeURIComponent(level)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
  } catch {
    /* offline: the local mirror keeps it */
  }
}
