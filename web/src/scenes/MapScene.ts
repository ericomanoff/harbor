import Phaser from 'phaser';
import { selection, settings, store } from '../app';
import { GAME_HEIGHT, MAP_W, PALETTE } from '../config';
import { BuildingView } from '../entities/Building';
import { PlateauView } from '../entities/Plateau';
import { UnitView } from '../entities/Unit';
import { isSystemNamespace } from '../layout/colors';
import { TILE, computeLayout, type MapLayout } from '../layout/grid';
import { nsKey } from '../store/cluster';

const EDGE = 14;
const SCROLL_SPEED = 0.6; // px per ms
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const CLICK_SLOP = 4;

export const buildingKey = (k: string): string => `b:${k}`;
export const unitKey = (k: string): string => `u:${k}`;

/**
 * The battlefield. Renders the store as plateaus, buildings and units,
 * reconciling views against the store whenever it changes.
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
  private dragStart?: Phaser.Math.Vector2;
  private panStart?: { px: number; py: number; sx: number; sy: number };
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

    store.subscribe(() => {
      this.dirty = true;
    });
    settings.changed.on(() => {
      this.dirty = true;
    });
    selection.changed.on(() => this.refreshSelection());

    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(K.UP), down: kb.addKey(K.DOWN), left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT),
      w: kb.addKey(K.W), a: kb.addKey(K.A), s: kb.addKey(K.S), d: kb.addKey(K.D),
    };
    kb.on('keydown-H', () => this.homeCamera());
    kb.on('keydown-N', () => {
      settings.showSystemNamespaces = !settings.showSystemNamespaces;
      settings.changed.emit();
    });
    kb.on('keydown-ESC', () => selection.clear());

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (p.x >= MAP_W) return;
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
    this.moveCamera(delta);
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
    cam.scrollX += dx;
    cam.scrollY += dy;
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (p.x >= MAP_W) return;
    if (p.rightButtonDown() || p.middleButtonDown()) {
      this.panStart = { px: p.x, py: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
      return;
    }
    this.dragStart = this.cameras.main.getWorldPoint(p.x, p.y).clone();
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const cam = this.cameras.main;
    if (this.panStart) {
      cam.scrollX = this.panStart.sx - (p.x - this.panStart.px) / cam.zoom;
      cam.scrollY = this.panStart.sy - (p.y - this.panStart.py) / cam.zoom;
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
    // Click: units sit on top of buildings, so test them first.
    for (const u of this.units.values()) {
      if (!u.dying && u.rect().contains(end.x, end.y)) {
        selection.set([unitKey(u.key)]);
        return;
      }
    }
    for (const b of this.buildings.values()) {
      if (b.rect().contains(end.x, end.y)) {
        selection.set([buildingKey(b.key)]);
        return;
      }
    }
    selection.clear();
  }

  private refreshSelection(): void {
    for (const b of this.buildings.values()) b.setSelected(selection.keys.has(buildingKey(b.key)));
    for (const u of this.units.values()) u.setSelected(selection.keys.has(unitKey(u.key)));
  }

  /** Recompute the layout and reconcile every view against the store. */
  private rebuild(): void {
    const show = (ns: string): boolean => settings.showSystemNamespaces || !isSystemNamespace(ns);
    const deployments = [...store.deployments.values()].filter((d) => show(d.ns));
    const pods = [...store.pods.values()].filter((p) => show(p.ns));
    this.layout = computeLayout([...store.nodes.values()], deployments, pods);
    const L = this.layout;

    this.cameras.main.setBounds(0, 0, L.width * TILE, L.height * TILE);
    this.drawGround();

    // Plateaus.
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

    // Buildings.
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
        v.destroy();
        this.buildings.delete(k);
      }
    }

    // Units. New ones roll out of their building's door when it is on screen.
    const livePods = new Set<string>();
    for (const p of pods) {
      const key = nsKey(p.ns, p.name);
      const place = L.units.get(key);
      if (!place) continue;
      livePods.add(key);
      const v = this.units.get(key);
      if (v && !v.dying) {
        v.update(p, place);
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

    // Drop selections that no longer exist.
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
    this.ground.fillStyle(PALETTE.ground, 1);
    this.ground.fillRect(0, 0, L.width * TILE, L.height * TILE);
    this.ground.fillStyle(PALETTE.voidStrip, 1);
    this.ground.fillRect(0, L.voidY * TILE, L.width * TILE, 4 * TILE);
    this.ground.lineStyle(1, 0x2a2a20, 1);
    this.ground.strokeRect(0.5, L.voidY * TILE + 0.5, L.width * TILE - 1, 4 * TILE - 1);
  }
}
