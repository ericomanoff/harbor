import { describe, expect, it } from 'vitest';
import type { Deployment, Node, Pod } from '../store/cluster';
import { buildingCells, cellAt, computeLayout, isCellFree, layoutPlateaus, plateauWidth, unitCells } from './grid';

const node = (name: string, cpu = 4000, ready = true): Node => ({ name, ready, cpuAlloc: cpu, memAlloc: 0, cpuReq: 0, memReq: 0, labels: {} });
const dep = (ns: string, name: string, mapPos?: { x: number; y: number }, release?: string): Deployment => ({ ns, name, replicas: 1, available: 1, updated: 1, image: 'x', conditions: [], ...(mapPos ? { mapPos } : {}), ...(release ? { release } : {}) });
const pod = (ns: string, name: string, nodeName: string, deployment?: string): Pod => ({ ns, name, node: nodeName, phase: 'Running', ready: true, restarts: 0, created: 'x', ...(deployment ? { deployment } : {}) });

describe('plateaus', () => {
  it('width grows with CPU within bounds', () => {
    expect(plateauWidth(0)).toBe(12);
    expect(plateauWidth(4000)).toBe(20);
    expect(plateauWidth(64000)).toBe(36);
  });

  it('are sorted by name and wrap into rows without overlapping', () => {
    const ps = layoutPlateaus([node('c'), node('a'), node('b'), node('d')]);
    expect(ps.map((p) => p.node)).toEqual(['a', 'b', 'c', 'd']);
    expect(ps[3]!.y).toBeGreaterThan(ps[0]!.y);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]!;
        const b = ps[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('building and unit zones stay inside the plateau and apart', () => {
    const p = layoutPlateaus([node('a', 8000)])[0]!;
    const bs = buildingCells(p);
    const us = unitCells(p);
    expect(bs.length).toBeGreaterThan(0);
    expect(us.length).toBeGreaterThan(0);
    const maxBuildingBottom = Math.max(...bs.map((c) => c.y + 3));
    const minUnitTop = Math.min(...us.map((c) => c.y));
    expect(minUnitTop).toBeGreaterThanOrEqual(maxBuildingBottom);
    for (const c of us) {
      expect(c.x).toBeGreaterThanOrEqual(p.x + 1);
      expect(c.x).toBeLessThan(p.x + p.w - 1);
      expect(c.y).toBeLessThan(p.y + p.h - 1);
    }
  });
});

describe('computeLayout', () => {
  const nodes = [node('w1'), node('w2')];

  it('is deterministic and keeps existing placements when a deployment is added', () => {
    const deps = [dep('a', 'web'), dep('b', 'api'), dep('a', 'db')];
    const l1 = computeLayout(nodes, deps, []);
    const l2 = computeLayout(nodes, deps, []);
    expect([...l1.buildings]).toEqual([...l2.buildings]);
    const l3 = computeLayout(nodes, [...deps, dep('c', 'new')], []);
    for (const [k, v] of l1.buildings) expect(l3.buildings.get(k)).toEqual(v);
  });

  it('honours a valid mapPos and ignores one that is not a building cell', () => {
    const cell = buildingCells(layoutPlateaus(nodes)[1]!)[0]!;
    const l = computeLayout(nodes, [dep('a', 'web', cell), dep('a', 'bad', { x: 999, y: 999 })], []);
    expect(l.buildings.get('a/web')).toMatchObject({ x: cell.x, y: cell.y, plateau: 'w2' });
    expect(l.buildings.get('a/bad')?.kind).toBe('plateau');
  });

  it('never places two buildings in the same cell', () => {
    const deps = Array.from({ length: 20 }, (_, i) => dep('ns', `d${i}`));
    const l = computeLayout(nodes, deps, []);
    const seen = new Set<string>();
    for (const p of l.buildings.values()) {
      const k = `${p.kind}:${p.x},${p.y}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('parks pods on their node, queues pending ones at their building, voids the rest', () => {
    const deps = [dep('a', 'web')];
    const pods = [pod('a', 'web-1', 'w2', 'web'), pod('a', 'web-2', '', 'web'), pod('a', 'orphan', 'ghost-node')];
    const l = computeLayout(nodes, deps, pods);
    expect(l.units.get('a/web-1')).toMatchObject({ kind: 'plateau', plateau: 'w2' });
    const b = l.buildings.get('a/web')!;
    expect(l.units.get('a/web-2')).toMatchObject({ kind: 'queue', x: b.x + 3, y: b.y });
    expect(l.units.get('a/orphan')).toMatchObject({ kind: 'void' });
    expect(l.units.get('a/orphan')!.y).toBeGreaterThanOrEqual(l.voidY);
  });

  it('places a release\'s structures as a block and boxes them', () => {
    const deps = [dep('a', 'solo'), dep('a', 'out-web', undefined, 'outpost'), dep('a', 'out-db', undefined, 'outpost'), dep('a', 'out-cache', undefined, 'outpost')];
    const l = computeLayout(nodes, deps, []);
    const members = ['a/out-cache', 'a/out-db', 'a/out-web'].map((k) => l.buildings.get(k)!);
    // All on one plateau, in consecutive cells (same row or wrapped), and boxed.
    expect(new Set(members.map((m) => m.plateau)).size).toBe(1);
    const box = l.releases.get('a/outpost')!;
    expect(box).toMatchObject({ ns: 'a', name: 'outpost' });
    for (const m of members) {
      expect(m.x).toBeGreaterThanOrEqual(box.x);
      expect(m.x + 3).toBeLessThanOrEqual(box.x + box.w);
      expect(m.y).toBeGreaterThanOrEqual(box.y);
      expect(m.y + 3).toBeLessThanOrEqual(box.y + box.h);
    }
    expect(l.releases.has('a/solo')).toBe(false);
    // Deterministic and independent of the solo structure.
    expect([...computeLayout(nodes, deps, []).releases]).toEqual([...l.releases]);
  });

  it('with no nodes everything lands in the void strip and the world still has a size', () => {
    const l = computeLayout([], [dep('a', 'web')], [pod('a', 'web-1', '', 'web')]);
    expect(l.plateaus).toEqual([]);
    expect(l.width).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(0);
    expect(l.buildings.get('a/web')?.kind).toBe('void');
  });
});

describe('cellAt / isCellFree', () => {
  const nodes = [node('w1'), node('w2')];
  const plateaus = layoutPlateaus(nodes);

  it('maps any tile inside a footprint to its cell origin', () => {
    const p = plateaus[0]!;
    const first = buildingCells(p)[0]!;
    for (const [dx, dy] of [[0, 0], [2, 2], [1, 0]] as const) {
      expect(cellAt(plateaus, first.x + dx, first.y + dy)).toMatchObject({ x: first.x, y: first.y, plateau: 'w1' });
    }
    const last = buildingCells(p).at(-1)!;
    expect(cellAt(plateaus, last.x + 2, last.y + 2)).toMatchObject({ x: last.x, y: last.y });
  });

  it('returns undefined off-plateau, in the unit zone, and in the margin', () => {
    const p = plateaus[0]!;
    expect(cellAt(plateaus, p.x, p.y)).toBeUndefined(); // margin tile
    expect(cellAt(plateaus, p.x + 1, p.y + 1 + 3 * 2 + 1)).toBeUndefined(); // unit zone
    expect(cellAt(plateaus, 500, 500)).toBeUndefined();
  });

  it('reports occupancy, ignoring the building being moved', () => {
    const l = computeLayout(nodes, [dep('a', 'web')], []);
    const b = l.buildings.get('a/web')!;
    expect(isCellFree(l, b)).toBe(false);
    expect(isCellFree(l, b, 'a/web')).toBe(true);
    expect(isCellFree(l, { x: b.x + 3, y: b.y })).toBe(true);
  });
});
