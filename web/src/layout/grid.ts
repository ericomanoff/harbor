import type { Deployment, Ingress, Node, Pod, Service, Workload } from '../store/cluster';
import { podsForService } from '../game/selector';
import { nsKey } from '../store/cluster';
import { hashString } from './hash';

/** World units are tiles; multiply by TILE for pixels. Pack art is 64 px, drawn at half scale. */
export const TILE = 32;
export const TILE_SRC = 64;
export const TILE_SCALE = TILE / TILE_SRC;
export const PLATEAU_H = 14;
export const BUILD_ROWS = 2; // rows of 3x3 building cells at the top of a plateau
export const BUILD_CELL = 3;
export const PLATEAU_GAP = 3;
export const PLATEAUS_PER_ROW = 3;
export const VOID_ROWS = 4; // staging strip below the plateaus for the unplaceable
export const MARGIN = 1;
/** Open sea drawn (and pannable) beyond the breakwater, in tiles. */
export const SEA_PAD = 12;

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

/** Rows of land on an island: margin row + building rows + the quay row; the rest is shallows. */
export function dockLandRows(): number {
  return 1 + BUILD_ROWS * BUILD_CELL + 1;
}

/** World rectangle (px) of an island's land, quay and the name label above it: the part that hovers and clicks. Shallows are water. */
export function dockLandRect(p: PlateauLayout): { x: number; y: number; w: number; h: number } {
  const label = 18;
  return { x: p.x * TILE, y: p.y * TILE - label, w: p.w * TILE, h: dockLandRows() * TILE + label };
}

export type PlacementKind = 'plateau' | 'queue' | 'void';

export interface Placement extends Cell {
  kind: PlacementKind;
  /** Node whose plateau this sits on, when kind is plateau. */
  plateau?: string;
}

/** Dashed base perimeter around a Helm release's structures, in tiles. */
export interface ReleaseBox {
  key: string;
  ns: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Anything that gets a 3x3 structure cell: Deployments and StatefulSets. */
export interface Structure {
  /** Placement key: "ns/name" for Deployments, "sts:ns/name" for StatefulSets. */
  key: string;
  ns: string;
  name: string;
  mapPos?: { x: number; y: number };
  release?: string;
}

export function structuresOf(deployments: Iterable<Deployment>, workloads: Iterable<Workload>): Structure[] {
  const out: Structure[] = [];
  for (const d of deployments) out.push({ key: nsKey(d.ns, d.name), ns: d.ns, name: d.name, ...(d.mapPos ? { mapPos: d.mapPos } : {}), ...(d.release ? { release: d.release } : {}) });
  for (const w of workloads) {
    if (w.kind !== 'StatefulSet') continue;
    out.push({ key: `sts:${nsKey(w.ns, w.name)}`, ns: w.ns, name: w.name, ...(w.mapPos ? { mapPos: w.mapPos } : {}), ...(w.release ? { release: w.release } : {}) });
  }
  return out;
}

/** The structure a pod belongs to, by placement key, if it has one. */
export function structureKeyOf(pod: Pod): string | undefined {
  if (pod.deployment) return nsKey(pod.ns, pod.deployment);
  if (pod.ownerKind === 'StatefulSet' && pod.ownerName) return `sts:${nsKey(pod.ns, pod.ownerName)}`;
  return undefined;
}

export interface MapLayout {
  plateaus: PlateauLayout[];
  releases: Map<string, ReleaseBox>;
  /** World size in tiles. */
  width: number;
  height: number;
  /** Top row of the void strip. */
  voidY: number;
  buildings: Map<string, Placement>;
  units: Map<string, Placement>;
  /** Services: one tile each, among the units of the plateau most of their pods are on. */
  services: Map<string, Placement>;
  /** Ingresses: gates in the south breakwater, GATE_W tiles wide, keyed "ns/name". */
  gates: Map<string, Placement>;
}

/** A gate spans this many tiles of breakwater (two towers and the opening). */
export const GATE_W = 3;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Bigger nodes get wider islands, bounded so one giant node does not dwarf the harbor. */
export function plateauWidth(cpuMilli: number): number {
  return clamp(12 + Math.round(cpuMilli / 2000) * 2, 12, 24);
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
  return claimFrom(taken, count, hashString(key) % count);
}

function claimFrom(taken: Set<number>, count: number, start: number): number {
  if (count === 0) return -1;
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
export function computeLayout(nodes: Node[], deployments: Deployment[], pods: Pod[], services: Service[] = [], workloads: Workload[] = [], ingresses: Ingress[] = []): MapLayout {
  const structures = structuresOf(deployments, workloads);
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
  const sortedDeps = [...structures].sort((a, b) => a.key.localeCompare(b.key));
  for (const d of sortedDeps) {
    if (!d.mapPos) continue;
    const idx = cells.findIndex((c) => c.x === d.mapPos?.x && c.y === d.mapPos?.y);
    if (idx >= 0 && !takenCells.has(idx)) {
      takenCells.add(idx);
      const c = cells[idx]!;
      buildings.set(d.key, { x: c.x, y: c.y, kind: 'plateau', plateau: c.plateau });
    }
  }
  const voidTaken = new Set<number>();
  const voidCols = Math.max(1, Math.floor((width - 2 * MARGIN) / BUILD_CELL));
  // Release members are placed as a block: the first by hash, the rest in
  // the next free cells, so a base expansion reads as one compound.
  const groups = new Map<string, Structure[]>();
  for (const d of sortedDeps) {
    if (!d.release || buildings.has(d.key)) continue;
    const gk = nsKey(d.ns, d.release);
    groups.set(gk, [...(groups.get(gk) ?? []), d]);
  }
  for (const [gk, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    let next = cells.length ? hashString(gk) % cells.length : -1;
    for (const d of members) {
      const idx = claimFrom(takenCells, cells.length, Math.max(0, next));
      if (idx < 0) break;
      const c = cells[idx]!;
      buildings.set(d.key, { x: c.x, y: c.y, kind: 'plateau', plateau: c.plateau });
      next = idx + 1;
    }
  }
  for (const d of sortedDeps) {
    const key = d.key;
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

  // Services first so they keep their tile when units come and go.
  const serviceOut = new Map<string, Placement>();
  const sortedSvcs = [...services].sort((a, b) => nsKey(a.ns, a.name).localeCompare(nsKey(b.ns, b.name)));
  for (const svc of sortedSvcs) {
    const key = nsKey(svc.ns, svc.name);
    const count = new Map<string, number>();
    for (const p of podsForService(svc, pods)) if (p.node && byNode.has(p.node)) count.set(p.node, (count.get(p.node) ?? 0) + 1);
    const host = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? plateaus[0]?.node;
    const plateau = host ? byNode.get(host) : undefined;
    if (plateau) {
      const cs = unitCellsByNode.get(plateau.node)!;
      const idx = claim(unitTaken.get(plateau.node)!, cs.length, `svc:${key}`);
      if (idx >= 0) {
        const c = cs[idx]!;
        serviceOut.set(key, { x: c.x, y: c.y, kind: 'plateau', plateau: plateau.node });
        continue;
      }
    }
    const v = claim(voidUnitTaken, voidUnitCols, `svc:${key}`);
    const slot = v >= 0 ? v : voidUnitTaken.size;
    serviceOut.set(key, { x: MARGIN + (slot % voidUnitCols), y: voidY, kind: 'void' });
  }

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
    const sk = structureKeyOf(p);
    const building = sk ? buildings.get(sk) : undefined;
    if (!p.node && building && sk) {
      const bk = sk;
      const n = queueCount.get(bk) ?? 0;
      queueCount.set(bk, n + 1);
      units.set(key, { x: building.x + BUILD_CELL, y: building.y + (n % BUILD_CELL), kind: 'queue' });
      continue;
    }
    const v = claim(voidUnitTaken, voidUnitCols, key);
    const slot = v >= 0 ? v : voidUnitTaken.size;
    units.set(key, { x: MARGIN + (slot % voidUnitCols), y: voidY + VOID_ROWS - 1 - Math.floor(slot / voidUnitCols) % VOID_ROWS, kind: 'void' });
  }

  // Perimeters: bounding box of each release's placed members.
  const releases = new Map<string, ReleaseBox>();
  for (const d of sortedDeps) {
    if (!d.release) continue;
    const b = buildings.get(d.key);
    if (!b || b.kind !== 'plateau') continue;
    const key = nsKey(d.ns, d.release);
    const cur = releases.get(key);
    if (!cur) {
      releases.set(key, { key, ns: d.ns, name: d.release, x: b.x, y: b.y, w: BUILD_CELL, h: BUILD_CELL });
    } else {
      const x0 = Math.min(cur.x, b.x);
      const y0 = Math.min(cur.y, b.y);
      const x1 = Math.max(cur.x + cur.w, b.x + BUILD_CELL);
      const y1 = Math.max(cur.y + cur.h, b.y + BUILD_CELL);
      releases.set(key, { ...cur, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }

  // Gates: slots of GATE_W tiles along the bottom edge, hashed with probing.
  const gates = new Map<string, Placement>();
  const slots = Math.max(1, Math.floor((width - 2 * MARGIN - 2) / (GATE_W + 1)));
  const gateTaken = new Set<number>();
  for (const ing of [...ingresses].sort((a, b) => nsKey(a.ns, a.name).localeCompare(nsKey(b.ns, b.name)))) {
    const key = nsKey(ing.ns, ing.name);
    const idx = claim(gateTaken, slots, `gate:${key}`);
    const slot = idx >= 0 ? idx : gateTaken.size;
    gates.set(key, { x: MARGIN + 1 + slot * (GATE_W + 1), y: height - 1, kind: 'void' });
  }

  return { plateaus, releases, width, height, voidY, buildings, units, services: serviceOut, gates };
}

/** The building cell whose 3x3 footprint contains tile (tx, ty), if any. */
export function cellAt(plateaus: PlateauLayout[], tx: number, ty: number): (Cell & { plateau: string }) | undefined {
  for (const p of plateaus) {
    const col = Math.floor((tx - p.x - 1) / BUILD_CELL);
    const row = Math.floor((ty - p.y - 1) / BUILD_CELL);
    const cols = Math.floor((p.w - 2) / BUILD_CELL);
    if (tx < p.x + 1 || ty < p.y + 1 || col >= cols || row >= BUILD_ROWS) continue;
    return { x: p.x + 1 + col * BUILD_CELL, y: p.y + 1 + row * BUILD_CELL, plateau: p.node };
  }
  return undefined;
}

/** True when no building other than `except` occupies the cell. */
export function isCellFree(layout: MapLayout, cell: Cell, except?: string): boolean {
  for (const [k, b] of layout.buildings) {
    if (k !== except && b.kind === 'plateau' && b.x === cell.x && b.y === cell.y) return false;
  }
  return true;
}
