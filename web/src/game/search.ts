import type { ClusterStore } from '../store/cluster';
import { nsKey } from '../store/cluster';

export interface SearchHit {
  /** Selection key: "b:ns/name" or "u:ns/name". */
  key: string;
  kind: 'structure' | 'unit';
  ns: string;
  name: string;
}

/**
 * Finds structures and units whose name or namespace contains the query.
 * Structures first, then prefix matches before substring matches, then by
 * name, so the first hit is the one a player most likely meant.
 */
export function searchObjects(query: string, store: Pick<ClusterStore, 'deployments' | 'pods'>, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: (SearchHit & { rank: number })[] = [];
  const consider = (kind: SearchHit['kind'], ns: string, name: string): void => {
    const hay = `${ns}/${name}`.toLowerCase();
    const idx = hay.indexOf(q);
    if (idx < 0) return;
    const prefix = name.toLowerCase().startsWith(q) || hay.startsWith(q);
    hits.push({ key: `${kind === 'structure' ? 'b' : 'u'}:${nsKey(ns, name)}`, kind, ns, name, rank: (kind === 'structure' ? 0 : 2) + (prefix ? 0 : 1) });
  };
  for (const d of store.deployments.values()) consider('structure', d.ns, d.name);
  for (const p of store.pods.values()) consider('unit', p.ns, p.name);
  hits.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.ns.localeCompare(b.ns));
  return hits.slice(0, limit).map(({ rank: _r, ...h }) => h);
}
