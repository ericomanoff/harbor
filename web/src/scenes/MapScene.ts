import Phaser from 'phaser';
import { createDeployment, setMapPos } from '../api/client';
import { eva, modal, mode, selection, settings, store } from '../app';
import { GAME_HEIGHT, MAP_W, PALETTE } from '../config';
import { BuildingView } from '../entities/Building';
import { PlateauView } from '../entities/Plateau';
import { UnitView } from '../entities/Unit';
import { isSystemNamespace } from '../layout/colors';
import { BUILD_CELL, TILE, cellAt, computeLayout, isCellFree, type Cell, type MapLayout } from '../layout/grid';
import { nsKey, type ClusterEvent } from '../store/cluster';
import { isObsolete } from '../game/unitState';
import { openBuildForm } from '../ui/buildForm';

const EDGE = 14;
const SCROLL_SPEED = 0.6; // px per ms
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const CLICK_SLOP = 4;

export const buildingKey = (k: string): string => `b:${k}`;
export const unitKey = (k: string): string => `u:${k}`;

interface GhostTarget {
  cell?: Cell & { plateau: string };
  valid: boolean;
}

/**
 * The battlefield. Renders the store as plateaus, buildings and units,
 * reconciling views against the store whenever it changes, and handles
 * placing and moving War Factories.
 */
export class MapScene extends Phaser.Scene {
  layout: MapLayout = computeLayout([], [], []);

  private readonly plateaus = new Map<string, PlateauView>();
  private readonly buildings = new Map<string, BuildingView>();
  private readonly units = new Map<string, UnitView>();
  private dirty = true;
  private initialised = false;

  private ground!: Phaser.GameObjects.Graphics;
  private selBox!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Graphics;
  private dragStart?: Phaser.Math.Vector2;
  private panStart?: { px: number; py: number; sx: number; sy: number };
  private dragBuilding?: { view: BuildingView; start: Phaser.Math.Vector2; moved: boolean };
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;

  constructor() {
    super('Map');
  }

  create(): void {
    const cam = this.cameras.main;
    cam.setViewport(0, 0, MAP_W, GAME_HEIGHT);
    cam.setBackgroundColor(PALETTE.ground);
    this.input.mouse?.disableContextMenu();

    this.ground = this.add.graphics().setDepth(-10);
    this.selBox = this.add.graphics().setDepth(100);
    this.ghost = this.add.graphics().setDepth(90);

    store.subscribe(() => {
      this.dirty = true;
    });
    settings.changed.on(() => {
      this.dirty = true;
    });
    selection.changed.on(() => this.refreshSelection());
    mode.changed.on(() => this.updateGhost());

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(K.UP), down: kb.addKey(K.DOWN), left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT),
      w: kb.addKey(K.W), a: kb.addKey(K.A), s: kb.addKey(K.S), d: kb.addKey(K.D),
    };
    kb.on('keydown-H', () => !modal.open && this.homeCamera());
    kb.on('keydown-N', () => {
      if (modal.open) return;
      settings.showSystemNamespaces = !settings.showSystemNamespaces;
      settings.changed.emit();
    });
    kb.on('keydown-B', () => !modal.open && mode.set(mode.current === 'place' ? 'idle' : 'place'));
    kb.on('keydown-ESC', () => {
      if (modal.open) return;
      if (mode.current === 'place') mode.set('idle');
      else selection.clear();
    });
    kb.addCapture('TAB');
    kb.on('keydown-TAB', (ev: KeyboardEvent) => !modal.open && this.cycleSelection(ev.shiftKey ? -1 : 1));

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (p.x >= MAP_W || modal.open) return;
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), ZOOM_MIN, ZOOM_MAX));
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));

    this.scene.launch('Hud');
    this.rebuild();
    this.homeCamera();
  }

  update(time: number, delta: number): void {
    if (this.dirty) {
      this.rebuild();
      this.dirty = false;
    }
    if (!modal.open) this.moveCamera(delta);
    for (const b of this.buildings.values()) b.tick(time);
    for (const u of this.units.values()) u.tick(time);
  }

  /** Zoom out until the whole world fits (never past ZOOM_MIN) and centre it. */
  homeCamera(): void {
    const cam = this.cameras.main;
    const ww = this.layout.width * TILE;
    const wh = this.layout.height * TILE;
    cam.setZoom(Phaser.Math.Clamp(Math.min(MAP_W / ww, GAME_HEIGHT / wh), ZOOM_MIN, 1));
    cam.centerOn(ww / 2, wh / 2);
  }

  centerOnWorld(x: number, y: number): void {
    this.cameras.main.centerOn(x, y);
  }

  /** Tab: step through structures then units, panning to each. */
  cycleSelection(dir: 1 | -1): void {
    const order = [
      ...[...this.buildings.keys()].sort().map((k) => buildingKey(k)),
      ...[...this.units.keys()].sort().map((k) => unitKey(k)),
    ];
    if (order.length === 0) return;
    const cur = [...selection.keys][0];
    const idx = cur ? order.indexOf(cur) : -1;
    const next = order[(idx + dir + order.length) % order.length]!;
    selection.set([next]);
    const v = next.startsWith('b:') ? this.buildings.get(next.slice(2)) : this.units.get(next.slice(2));
    if (v) this.centerOnWorld(v.x + TILE, v.y + TILE);
  }

  /** Flash the unit or structure a Warning event names. */
  flashFor(ev: ClusterEvent): void {
    const now = this.time.now;
    if (ev.kind === 'Pod') this.units.get(nsKey(ev.ns, ev.name))?.flash(now);
    else if (ev.kind === 'Deployment') this.buildings.get(nsKey(ev.ns, ev.name))?.flash(now);
    else if (ev.kind === 'ReplicaSet') {
      for (const u of this.units.values()) if (u.pod.ns === ev.ns && u.pod.ownerRS === ev.name) u.flash(now);
    }
  }

  private moveCamera(delta: number): void {
    const cam = this.cameras.main;
    const p = this.input.activePointer;
    const v = SCROLL_SPEED * delta / cam.zoom;
    let dx = 0;
    let dy = 0;
    if (this.keys.left.isDown || this.keys.a.isDown) dx -= v;
    if (this.keys.right.isDown || this.keys.d.isDown) dx += v;
    if (this.keys.up.isDown || this.keys.w.isDown) dy -= v;
    if (this.keys.down.isDown || this.keys.s.isDown) dy += v;
    // Edge scroll on the three edges that are not shared with the sidebar.
    const inMap = p.x >= 0 && p.x < MAP_W && p.y >= 0 && p.y < GAME_HEIGHT && this.game.canvas.matches(':hover');
    if (inMap && !this.panStart) {
      if (p.x < EDGE) dx -= v;
      if (p.y < EDGE) dy -= v;
      if (p.y > GAME_HEIGHT - EDGE) dy += v;
    }
    if (dx || dy) {
      cam.scrollX += dx;
      cam.scrollY += dy;
      this.updateGhost();
    }
  }

  // ---- placement ---------------------------------------------------------

  /** Where the 3x3 ghost footprint would land under the pointer. */
  private ghostTarget(p: Phaser.Input.Pointer, except?: string): GhostTarget {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const cell = cellAt(this.layout.plateaus, Math.floor(w.x / TILE), Math.floor(w.y / TILE));
    return { cell, valid: !!cell && isCellFree(this.layout, cell, except) };
  }

  /** Draws (or clears) the footprint for placing or moving a building. */
  private updateGhost(p: Phaser.Input.Pointer = this.input.activePointer): GhostTarget | undefined {
    const moving = this.dragBuilding?.moved ? this.dragBuilding.view.key : undefined;
    if ((mode.current !== 'place' && !moving) || p.x >= MAP_W) {
      this.ghost.clear();
      return undefined;
    }
    const t = this.ghostTarget(p, moving);
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const x = t.cell ? t.cell.x * TILE : Math.floor(w.x / TILE) * TILE - TILE;
    const y = t.cell ? t.cell.y * TILE : Math.floor(w.y / TILE) * TILE - TILE;
    const s = BUILD_CELL * TILE;
    this.ghost.clear();
    this.ghost.fillStyle(t.valid ? PALETTE.radarGreen : PALETTE.alert, 0.18).fillRect(x, y, s, s);
    this.ghost.lineStyle(2, t.valid ? PALETTE.radarGreen : PALETTE.alert, 1).strokeRect(x + 1, y + 1, s - 2, s - 2);
    return t;
  }

  private startBuild(cell: Cell): void {
    mode.set('idle');
    this.ghost.clear();
    const names = [...store.namespaces.keys()].sort((a, b) => {
      const sa = isSystemNamespace(a) ? 1 : 0;
      const sb = isSystemNamespace(b) ? 1 : 0;
      return sa - sb || a.localeCompare(b);
    });
    openBuildForm({
      namespaces: names,
      defaultNamespace: names.includes('default') ? 'default' : names[0],
      mapPos: { x: cell.x, y: cell.y },
      onSubmit: async (req) => {
        await createDeployment(req);
        eva.emit(`CONSTRUCTION STARTED: ${req.name}`);
      },
    });
  }

  // ---- pointer -----------------------------------------------------------

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (p.x >= MAP_W || modal.open) return;
    if (p.rightButtonDown() || p.middleButtonDown()) {
      if (mode.current === 'place') {
        mode.set('idle');
        return;
      }
      this.panStart = { px: p.x, py: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
      return;
    }
    if (mode.current === 'place') {
      const t = this.updateGhost(p);
      if (t?.valid && t.cell) this.startBuild(t.cell);
      else eva.emit('CANNOT DEPLOY HERE');
      return;
    }
    const w = this.cameras.main.getWorldPoint(p.x, p.y).clone();
    // A press on a building may become a move; a press anywhere else may
    // become a box selection.
    for (const u of this.units.values()) {
      if (!u.dying && u.rect().contains(w.x, w.y)) {
        this.dragStart = w;
        return;
      }
    }
    for (const b of this.buildings.values()) {
      if (b.rect().contains(w.x, w.y)) {
        this.dragBuilding = { view: b, start: w, moved: false };
        return;
      }
    }
    this.dragStart = w;
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const cam = this.cameras.main;
    if (this.panStart) {
      cam.scrollX = this.panStart.sx - (p.x - this.panStart.px) / cam.zoom;
      cam.scrollY = this.panStart.sy - (p.y - this.panStart.py) / cam.zoom;
      return;
    }
    if (mode.current === 'place') {
      this.updateGhost(p);
      return;
    }
    if (this.dragBuilding && p.isDown) {
      const w = cam.getWorldPoint(p.x, p.y);
      if (!this.dragBuilding.moved && Phaser.Math.Distance.Between(w.x, w.y, this.dragBuilding.start.x, this.dragBuilding.start.y) > CLICK_SLOP * 2) {
        this.dragBuilding.moved = true;
      }
      if (this.dragBuilding.moved) this.updateGhost(p);
      return;
    }
    if (this.dragStart && p.isDown) {
      const w = cam.getWorldPoint(p.x, p.y);
      const r = Phaser.Geom.Rectangle.FromPoints([this.dragStart, w]);
      this.selBox.clear();
      if (r.width > CLICK_SLOP || r.height > CLICK_SLOP) {
        this.selBox.lineStyle(1, PALETTE.radarGreen, 1).strokeRectShape(r);
      }
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (this.panStart) {
      this.panStart = undefined;
      return;
    }
    if (this.dragBuilding) {
      const { view, moved } = this.dragBuilding;
      this.dragBuilding = undefined;
      if (!moved) {
        selection.set([buildingKey(view.key)]);
        return;
      }
      const t = this.ghostTarget(p, view.key);
      this.ghost.clear();
      if (!t.valid || !t.cell) {
        eva.emit('CANNOT DEPLOY HERE');
        return;
      }
      const { ns, name } = view.dep;
      const cell = t.cell;
      setMapPos(ns, name, { x: cell.x, y: cell.y })
        .then(() => eva.emit(`STRUCTURE RELOCATED: ${name}`))
        .catch((e: unknown) => eva.emit(`UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    if (!this.dragStart) return;
    const start = this.dragStart;
    this.dragStart = undefined;
    this.selBox.clear();
    const end = this.cameras.main.getWorldPoint(p.x, p.y);
    const r = Phaser.Geom.Rectangle.FromPoints([start, end]);
    if (r.width > CLICK_SLOP || r.height > CLICK_SLOP) {
      const picked: string[] = [];
      for (const u of this.units.values()) {
        if (!u.dying && Phaser.Geom.Intersects.RectangleToRectangle(r, u.rect())) picked.push(unitKey(u.key));
      }
      selection.set(picked);
      return;
    }
    for (const u of this.units.values()) {
      if (!u.dying && u.rect().contains(end.x, end.y)) {
        selection.set([unitKey(u.key)]);
        return;
      }
    }
    selection.clear();
  }

  private refreshSelection(): void {
    for (const b of this.buildings.values()) b.setSelected(selection.keys.has(buildingKey(b.key)));
    for (const u of this.units.values()) u.setSelected(selection.keys.has(unitKey(u.key)));
  }

  // ---- reconcile ---------------------------------------------------------

  /** Recompute the layout and reconcile every view against the store. */
  private rebuild(): void {
    const show = (ns: string): boolean => settings.showSystemNamespaces || !isSystemNamespace(ns);
    const deployments = [...store.deployments.values()].filter((d) => show(d.ns));
    const pods = [...store.pods.values()].filter((p) => show(p.ns));
    this.layout = computeLayout([...store.nodes.values()], deployments, pods);
    const L = this.layout;

    this.cameras.main.setBounds(0, 0, L.width * TILE, L.height * TILE);
    this.drawGround();

    const liveNodes = new Set<string>();
    for (const pl of L.plateaus) {
      liveNodes.add(pl.node);
      const v = this.plateaus.get(pl.node);
      if (v) v.redraw(pl);
      else this.plateaus.set(pl.node, new PlateauView(this, pl));
    }
    for (const [k, v] of this.plateaus) {
      if (!liveNodes.has(k)) {
        v.destroy();
        this.plateaus.delete(k);
      }
    }

    const liveDeps = new Set<string>();
    for (const d of deployments) {
      const key = nsKey(d.ns, d.name);
      const place = L.buildings.get(key);
      if (!place) continue;
      liveDeps.add(key);
      const v = this.buildings.get(key);
      if (v) v.update(d, place);
      else this.buildings.set(key, new BuildingView(this, key, d, place));
    }
    for (const [k, v] of this.buildings) {
      if (!liveDeps.has(k)) {
        if (this.dragBuilding?.view === v) this.dragBuilding = undefined;
        v.destroy();
        this.buildings.delete(k);
      }
    }

    const livePods = new Set<string>();
    for (const p of pods) {
      const key = nsKey(p.ns, p.name);
      const place = L.units.get(key);
      if (!place) continue;
      livePods.add(key);
      const v = this.units.get(key);
      const obsolete = isObsolete(p, p.deployment ? store.deployments.get(nsKey(p.ns, p.deployment)) : undefined);
      if (v && !v.dying) {
        v.update(p, place, obsolete);
      } else {
        const building = p.deployment ? this.buildings.get(nsKey(p.ns, p.deployment)) : undefined;
        const from = this.initialised && building ? building.door() : undefined;
        this.units.set(key, new UnitView(this, key, p, place, from));
      }
    }
    for (const [k, v] of this.units) {
      if (!livePods.has(k) && !v.dying) {
        v.die();
        this.units.delete(k);
      }
    }

    const stale = [...selection.keys].filter((k) => {
      const [kind, key] = [k.slice(0, 1), k.slice(2)];
      return kind === 'b' ? !liveDeps.has(key) : !livePods.has(key);
    });
    if (stale.length) selection.set([...selection.keys].filter((k) => !stale.includes(k)));
    this.refreshSelection();
    this.initialised = true;
  }

  private drawGround(): void {
    const L = this.layout;
    this.ground.clear();
    this.ground.fillStyle(PALETTE.ground, 1).fillRect(0, 0, L.width * TILE, L.height * TILE);
    this.ground.fillStyle(PALETTE.voidStrip, 1).fillRect(0, L.voidY * TILE, L.width * TILE, 4 * TILE);
    this.ground.lineStyle(1, 0x2a2a20, 1).strokeRect(0.5, L.voidY * TILE + 0.5, L.width * TILE - 1, 4 * TILE - 1);
  }
}
