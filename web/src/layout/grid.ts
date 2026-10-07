import type { Deployment, Node, Pod } from '../store/cluster';
import { nsKey } from '../store/cluster';
import { hashString } from './hash';

/** World units are tiles; multiply by TILE for pixels. */
export const TILE = 24;
export const PLATEAU_H = 14;
export const BUILD_ROWS = 2; // rows of 3x3 building cells at the top of a plateau
export const BUILD_CELL = 3;
export const PLATEAU_GAP = 3;
export const PLATEAUS_PER_ROW = 3;
export const VOID_ROWS = 4; // staging strip below the plateaus for the unplaceable
export const MARGIN = 1;

export interface Cell {
  x: number;
  y: number;
}

export interface PlateauLayout extends Cell {
  node: string;
  w: number;
  h: number;
  ready: boolean;
}

export type PlacementKind = 'plateau' | 'queue' | 'void';

export interface Placement extends Cell {
  kind: PlacementKind;
  /** Node whose plateau this sits on, when kind is plateau. */
  plateau?: string;
}

export interface MapLayout {
  plateaus: PlateauLayout[];
  /** World size in tiles. */
  width: number;
  height: number;
  /** Top row of the void strip. */
  voidY: number;
  buildings: Map<string, Placement>;
  units: Map<string, Placement>;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Bigger nodes get wider plateaus, bounded so one giant node does not dwarf the map. */
export function plateauWidth(cpuMilli: number): number {
  return clamp(12 + Math.round(cpuMilli / 1000) * 2, 12, 36);
}

export function layoutPlateaus(nodes: Node[]): PlateauLayout[] {
  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
  const out: PlateauLayout[] = [];
  let x = MARGIN;
  let y = MARGIN;
  sorted.forEach((n, i) => {
    if (i > 0 && i % PLATEAUS_PER_ROW === 0) {
      x = MARGIN;
      y += PLATEAU_H + PLATEAU_GAP;
    }
    out.push({ node: n.name, x, y, w: plateauWidth(n.cpuAlloc), h: PLATEAU_H, ready: n.ready });
    x += plateauWidth(n.cpuAlloc) + PLATEAU_GAP;
  });
  return out;
}

export function buildingCells(p: PlateauLayout): Cell[] {
  const cols = Math.floor((p.w - 2) / BUILD_CELL);
  const cells: Cell[] = [];
  for (let r = 0; r < BUILD_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: p.x + 1 + c * BUILD_CELL, y: p.y + 1 + r * BUILD_CELL });
    }
  }
  return cells;
}

export function unitCells(p: PlateauLayout): Cell[] {
  const top = p.y + 1 + BUILD_ROWS * BUILD_CELL + 1;
  const cells: Cell[] = [];
  for (let y = top; y < p.y + p.h - 1; y++) {
    for (let x = p.x + 1; x < p.x + p.w - 1; x++) cells.push({ x, y });
  }
  return cells;
}

/** Linear probing from a hashed start; returns the index claimed or -1 when full. */
function claim(taken: Set<number>, count: number, key: string): number {
  if (count === 0) return -1;
  const start = hashString(key) % count;
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % count;
    if (!taken.has(idx)) {
      taken.add(idx);
      return idx;
    }
  }
  return -1;
}

/**
 * Lays out the whole map. Deterministic: the same cluster state always
 * yields the same picture, and adding one object moves nothing else unless
 * a hash collision forces a probe.
 */
export function computeLayout(nodes: Node[], deployments: Deployment[], pods: Pod[]): MapLayout {
  const plateaus = layoutPlateaus(nodes);
  const right = plateaus.reduce((m, p) => Math.max(m, p.x + p.w), 0);
  const bottom = plateaus.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  const voidY = (plateaus.length ? bottom : MARGIN) + PLATEAU_GAP;
  const width = Math.max(32, right + MARGIN, 24 + MARGIN * 2);
  const height = voidY + VOID_ROWS + MARGIN;
  const byNode = new Map(plateaus.map((p) => [p.node, p]));

  // Buildings: explicit map positions first, then hashed into free cells.
  const cells = plateaus.flatMap((p) => buildingCells(p).map((c) => ({ ...c, plateau: p.node })));
  const takenCells = new Set<number>();
  const buildings = new Map<string, Placement>();
  const sortedDeps = [...deployments].sort((a, b) => nsKey(a.ns, a.name).localeCompare(nsKey(b.ns, b.name)));
  for (const d of sortedDeps) {
    if (!d.mapPos) continue;
    const idx = cells.findIndex((c) => c.x === d.mapPos?.x && c.y === d.mapPos?.y);
    if (idx >= 0 && !takenCells.has(idx)) {
      takenCells.add(idx);
      const c = cells[idx]!;
      buildings.set(nsKey(d.ns, d.name), { x: c.x, y: c.y, kind: 'plateau', plateau: c.plateau });
    }
  }
  const voidTaken = new Set<number>();
  const voidCols = Math.max(1, Math.floor((width - 2 * MARGIN) / BUILD_CELL));
  for (const d of sortedDeps) {
    const key = nsKey(d.ns, d.name);
    if (buildings.has(key)) continue;
    const idx = claim(takenCells, cells.length, key);
    if (idx >= 0) {
      const c = cells[idx]!;
      buildings.set(key, { x: c.x, y: c.y, kind: 'plateau', plateau: c.plateau });
    } else {
      const v = claim(voidTaken, voidCols, key);
      const slot = v >= 0 ? v : voidTaken.size;
      buildings.set(key, { x: MARGIN + slot * BUILD_CELL, y: voidY, kind: 'void' });
    }
  }

  // Units: parked on their node's plateau; pending ones queue beside their
  // building; the rest go to the void strip.
  const unitCellsByNode = new Map(plateaus.map((p) => [p.node, unitCells(p)]));
  const unitTaken = new Map(plateaus.map((p) => [p.node, new Set<number>()]));
  const queueCount = new Map<string, number>();
  const voidUnitTaken = new Set<number>();
  const voidUnitCols = Math.max(1, width - 2 * MARGIN);
  const units = new Map<string, Placement>();
  const sortedPods = [...pods].sort((a, b) => nsKey(a.ns, a.name).localeCompare(nsKey(b.ns, b.name)));
  for (const p of sortedPods) {
    const key = nsKey(p.ns, p.name);
    const plateau = p.node ? byNode.get(p.node) : undefined;
    if (plateau) {
      const cs = unitCellsByNode.get(plateau.node)!;
      const idx = claim(unitTaken.get(plateau.node)!, cs.length, key);
      if (idx >= 0) {
        const c = cs[idx]!;
        units.set(key, { x: c.x, y: c.y, kind: 'plateau', plateau: plateau.node });
        continue;
      }
    }
    const building = p.deployment ? buildings.get(nsKey(p.ns, p.deployment)) : undefined;
    if (!p.node && building) {
      const bk = nsKey(p.ns, p.deployment!);
      const n = queueCount.get(bk) ?? 0;
      queueCount.set(bk, n + 1);
      units.set(key, { x: building.x + BUILD_CELL, y: building.y + (n % BUILD_CELL), kind: 'queue' });
      continue;
    }
    const v = claim(voidUnitTaken, voidUnitCols, key);
    const slot = v >= 0 ? v : voidUnitTaken.size;
    units.set(key, { x: MARGIN + (slot % voidUnitCols), y: voidY + VOID_ROWS - 1 - Math.floor(slot / voidUnitCols) % VOID_ROWS, kind: 'void' });
  }

  return { plateaus, width, height, voidY, buildings, units };
}
