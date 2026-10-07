import { hashString } from './hash';

/** Eight faction colours in the C&C tradition; a namespace always maps to the same one. */
export const FACTION_PALETTE = [
  0xe8c547, // gold
  0xd83a2a, // red
  0x3a7bd8, // blue
  0x2ab5a5, // teal
  0xe8822a, // orange
  0x9a4ad8, // purple
  0x5ab52a, // green
  0x9a9a9a, // grey
] as const;

export function namespaceColor(ns: string): number {
  return FACTION_PALETTE[hashString(ns) % FACTION_PALETTE.length] ?? 0x9a9a9a;
}

/** Cluster plumbing that clutters the map on a small cluster. Hidden by default. */
export function isSystemNamespace(ns: string): boolean {
  return ns.startsWith('kube-') || ns === 'local-path-storage';
}

export function hexString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
