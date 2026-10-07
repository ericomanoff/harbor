import type { Node } from '../store/cluster';

export type PowerLevel = 'ok' | 'low' | 'critical';

export interface Power {
  /** Sum of CPU requests on ready nodes, millicores. */
  req: number;
  /** Sum of allocatable CPU on ready nodes, millicores. */
  alloc: number;
  /** req / alloc, 0 when nothing is allocatable. */
  frac: number;
  level: PowerLevel;
}

/** Cluster power, C&C style: CPU requests over allocatable across ready nodes. */
export function computePower(nodes: Iterable<Node>): Power {
  let req = 0;
  let alloc = 0;
  for (const n of nodes) {
    if (!n.ready) continue;
    req += n.cpuReq;
    alloc += n.cpuAlloc;
  }
  const frac = alloc > 0 ? req / alloc : 0;
  const level: PowerLevel = frac < 0.6 ? 'ok' : frac < 0.85 ? 'low' : 'critical';
  return { req, alloc, frac, level };
}

export function formatPower(p: Power): string {
  if (!p.alloc) return 'no power';
  return `${Math.round(p.frac * 100)}%  ${(p.req / 1000).toFixed(1)}/${(p.alloc / 1000).toFixed(0)} cpu`;
}
