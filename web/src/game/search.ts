import type { ClusterStore } from '../store/cluster';
import { nsKey } from '../store/cluster';

export interface SearchHit {
  /** Selection key: "b:ns/name" or "u:ns/name". */
  key: string;
  kind: 'structure' | 'unit' | 'service' | 'workload' | 'gate' | 'island';
  ns: string;
  name: string;
}

/**
 * Finds structures and units whose name or namespace contains the query.
 * Structures first, then prefix matches before substring matches, then by
 * name, so the first hit is the one a player most likely meant.
 */
export function searchObjects(query: string, store: Pick<ClusterStore, 'deployments' | 'pods'> & Partial<Pick<ClusterStore, 'services' | 'workloads' | 'ingresses' | 'nodes'>>, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: (SearchHit & { rank: number })[] = [];
  const consider = (kind: SearchHit['kind'], ns: string, name: string, key?: string): void => {
    const hay = `${ns}/${name}`.toLowerCase();
    const idx = hay.indexOf(q);
    if (idx < 0) return;
    const prefix = name.toLowerCase().startsWith(q) || hay.startsWith(q);
    const prefixChar = kind === 'structure' ? 'b' : kind === 'service' ? 's' : kind === 'workload' ? 'w' : kind === 'gate' ? 'g' : 'u';
    hits.push({ key: key ?? `${prefixChar}:${nsKey(ns, name)}`, kind, ns, name, rank: (kind === 'structure' ? 0 : kind === 'island' ? 1 : kind === 'service' ? 2 : kind === 'gate' ? 2 : kind === 'workload' ? 3 : 4) + (prefix ? 0 : 1) });
  };
  for (const d of store.deployments.values()) consider('structure', d.ns, d.name);
  for (const w of store.workloads?.values() ?? []) {
    if (w.kind === 'StatefulSet') consider('structure', w.ns, w.name, `b:sts:${nsKey(w.ns, w.name)}`);
    else consider('workload', w.ns, w.name, `w:${w.kind}:${nsKey(w.ns, w.name)}`);
  }
  for (const n of store.nodes?.values() ?? []) consider('island', '', n.name, `dock:${n.name}`);
  for (const sv of store.services?.values() ?? []) consider('service', sv.ns, sv.name);
  for (const i of store.ingresses?.values() ?? []) consider('gate', i.ns, i.name);
  for (const p of store.pods.values()) consider('unit', p.ns, p.name);
  hits.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.ns.localeCompare(b.ns));
  return hits.slice(0, limit).map(({ rank: _r, ...h }) => h);
}
