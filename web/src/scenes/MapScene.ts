import Phaser from 'phaser';
import { createDeployment, setMapPos, workloads as workloadApi } from '../api/client';
import { eva, modal, mode, selection, settings, store } from '../app';
import { SEA } from '../config';
import { Hud, type MapApi } from '../hud/hud';
import { BuildingView, structureOfDeployment, structureOfStatefulSet } from '../entities/Shipyard';
import { DockView } from '../entities/Dock';
import { UnitView } from '../entities/Ship';
import { ReleaseView } from '../entities/Anchorage';
import { ServiceView } from '../entities/Lighthouse';
import { GateView } from '../entities/Gate';
import { Sea } from '../world/Sea';
import { floatText, splash } from '../world/fx';
import { maybeAutoStartTour, startTour } from '../tour/tour';
import { splash as loadingSplash } from '../boot/splash';
import { ingressesForService, podsForService, servicesForIngress, servicesForPod } from '../game/selector';
import { openMissionSelect } from '../ui/missionSelect';
import { openTechTree } from '../ui/techTree';
import { isSystemNamespace } from '../layout/colors';
import { BUILD_CELL, SEA_PAD, TILE, cellAt, computeLayout, isCellFree, structureKeyOf, type Cell, type MapLayout } from '../layout/grid';
import { nsKey, type ClusterEvent } from '../store/cluster';
import { isObsolete } from '../game/unitState';
import { openBuildForm } from '../ui/buildForm';
import { openFilter } from '../ui/filterPanel';
import { openSearch } from '../ui/searchBox';
import { namespaceVisible } from '../game/filter';
import { sfx } from '../game/audio';

const EDGE = 14;

const MAP_W = (): number => window.innerWidth;
const MAP_H = (): number => window.innerHeight;
const SCROLL_SPEED = 0.6; // px per ms
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const CLICK_SLOP = 4;

export const buildingKey = (k: string): string => `b:${k}`;
export const unitKey = (k: string): string => `u:${k}`;
export const releaseKey = (k: string): string => `r:${k}`;
export const serviceKey = (k: string): string => `s:${k}`;
export const gateKey = (k: string): string => `g:${k}`;

interface GhostTarget {
  cell?: Cell & { plateau: string };
  valid: boolean;
}

/**
 * The battlefield. Renders the store as plateaus, buildings and units,
 * reconciling views against the store whenever it changes, and handles
 * placing and moving War Factories.
 */
export class MapScene extends Phaser.Scene implements MapApi {
  layout: MapLayout = computeLayout([], [], []);

  private readonly plateaus = new Map<string, DockView>();
  private sea!: Sea;
  private readonly buildings = new Map<string, BuildingView>();
  private readonly units = new Map<string, UnitView>();
  private readonly releases = new Map<string, ReleaseView>();
  private readonly services = new Map<string, ServiceView>();
  private readonly gates = new Map<string, GateView>();
  private links!: Phaser.GameObjects.Graphics;
  private dirty = true;
  private initialised = false;

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
    cam.setBackgroundColor(SEA.water);
    this.scale.on('resize', () => this.updateGhost());
    this.input.mouse?.disableContextMenu();

    this.sea = new Sea(this);
    this.selBox = this.add.graphics().setDepth(100);
    this.ghost = this.add.graphics().setDepth(90);
    this.links = this.add.graphics().setDepth(16);

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
    kb.on('keydown-FORWARD_SLASH', (ev: KeyboardEvent) => {
      if (modal.open) return;
      ev.preventDefault();
      this.openSearch();
    });
    // preventDefault keeps the hotkey's character out of the overlay's input.
    kb.on('keydown-F', (ev: KeyboardEvent) => {
      if (modal.open) return;
      ev.preventDefault();
      openFilter();
    });
    kb.on('keydown-T', (ev: KeyboardEvent) => {
      if (modal.open) return;
      ev.preventDefault();
      openTechTree();
    });
    kb.on('keydown-C', (ev: KeyboardEvent) => {
      if (modal.open) return;
      ev.preventDefault();
      openMissionSelect();
    });
    kb.on('keydown-M', () => {
      if (modal.open) return;
      settings.sound = !settings.sound;
      sfx.setEnabled(settings.sound);
      settings.changed.emit();
    });
    kb.addCapture('TAB');
    kb.on('keydown-TAB', (ev: KeyboardEvent) => !modal.open && this.cycleSelection(ev.shiftKey ? -1 : 1));

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (modal.open) return;
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), ZOOM_MIN, ZOOM_MAX));
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));

    this.rebuild();
    this.homeCamera();
    new Hud(this);
    document.querySelector<HTMLButtonElement>('#hud [data-rail=help]')?.addEventListener('click', () => startTour(this));
    void loadingSplash().done().then(() => maybeAutoStartTour(this));
  }

  update(time: number, delta: number): void {
    if (this.dirty) {
      this.rebuild();
      this.dirty = false;
    }
    if (!modal.open) this.moveCamera(delta);
    this.sea.update(delta);
    for (const d of this.plateaus.values()) d.tick(time);
    for (const b of this.buildings.values()) b.tick(time);
    for (const u of this.units.values()) u.tick(time);
    for (const s of this.services.values()) s.tick(time);
    for (const gt of this.gates.values()) gt.tick(time);
  }

  /** Zoom out until the whole world fits inside the HUD margins and centre it. */
  homeCamera(): void {
    const cam = this.cameras.main;
    const ww = this.layout.width * TILE;
    const wh = this.layout.height * TILE;
    const freeW = MAP_W() - 2 * 90; // rails and bars on both sides
    const freeH = MAP_H() - 150 - 90; // top bar and bottom buttons
    cam.setZoom(Phaser.Math.Clamp(Math.min(freeW / ww, freeH / wh), ZOOM_MIN, 1));
    cam.centerOn(ww / 2, wh / 2 + 20 / cam.zoom);
  }

  centerOnWorld(x: number, y: number): void {
    this.cameras.main.centerOn(x, y);
  }

  home(): void {
    this.homeCamera();
  }

  zoomBy(factor: number): void {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  }

  /** World rectangle of a selectable thing, or undefined. */
  private worldRectOf(key: string): Phaser.Geom.Rectangle | undefined {
    const id = key.slice(key.indexOf(':') + 1);
    if (key.startsWith('b:')) return this.buildings.get(id)?.rect();
    if (key.startsWith('u:')) return this.units.get(id)?.rect();
    if (key.startsWith('s:')) return this.services.get(id)?.rect();
    if (key.startsWith('r:')) return this.releases.get(id)?.plateRect();
    if (key.startsWith('g:')) return this.gates.get(id)?.rect();
    if (key.startsWith('dock:')) {
      const p = this.layout.plateaus.find((pl) => pl.node === id);
      return p ? new Phaser.Geom.Rectangle(p.x * TILE, p.y * TILE, p.w * TILE, p.h * TILE) : undefined;
    }
    if (key.startsWith('unit-of:')) {
      for (const u of this.units.values()) if (!u.dying && u.pod.deployment && nsKey(u.pod.ns, u.pod.deployment) === id) return u.rect();
    }
    return undefined;
  }

  screenRectOf(key: string): { x: number; y: number; width: number; height: number } | undefined {
    const r = this.worldRectOf(key);
    if (!r) return undefined;
    // From scroll and zoom rather than worldView, which lags a frame after a pan.
    const cam = this.cameras.main;
    const vx = cam.scrollX + (cam.width / 2) * (1 - 1 / cam.zoom);
    const vy = cam.scrollY + (cam.height / 2) * (1 - 1 / cam.zoom);
    return { x: (r.x - vx) * cam.zoom, y: (r.y - vy) * cam.zoom, width: r.width * cam.zoom, height: r.height * cam.zoom };
  }

  focusKey(key: string): void {
    const r = this.worldRectOf(key);
    if (!r) return;
    const cam = this.cameras.main;
    const target = key.startsWith('dock:') ? Math.min(1, Math.max(ZOOM_MIN, (MAP_H() - 260) / r.height)) : 1.3;
    cam.setZoom(Phaser.Math.Clamp(target, ZOOM_MIN, ZOOM_MAX));
    cam.centerOn(r.centerX, r.centerY + 40 / cam.zoom);
  }

  cameraView(): { x: number; y: number; width: number; height: number } {
    const v = this.cameras.main.worldView;
    return { x: v.x, y: v.y, width: v.width, height: v.height };
  }

  /** "/" search overlay; picking a hit selects it and pans to it. */
  openSearch(): void {
    openSearch((hit) => {
      const v = hit.kind === 'structure' ? this.buildings.get(hit.key.slice(2)) : hit.kind === 'service' ? this.services.get(hit.key.slice(2)) : hit.kind === 'gate' ? this.gates.get(hit.key.slice(2)) : hit.kind === 'workload' ? undefined : this.units.get(hit.key.slice(2));
      if (v) this.centerOnWorld(v.x + TILE, v.y + TILE);
    });
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
    const inMap = p.x >= 0 && p.x < MAP_W() && p.y >= 0 && p.y < MAP_H() && this.game.canvas.matches(':hover');
    if (inMap && !this.panStart) {
      if (p.x < EDGE) dx -= v;
      if (p.y < EDGE) dy -= v;
      if (p.y > MAP_H() - EDGE) dy += v;
      if (p.x > MAP_W() - EDGE) dx += v;
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
    if (mode.current !== 'place' && !moving) {
      this.ghost.clear();
      return undefined;
    }
    const t = this.ghostTarget(p, moving);
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const x = t.cell ? t.cell.x * TILE : Math.floor(w.x / TILE) * TILE - TILE;
    const y = t.cell ? t.cell.y * TILE : Math.floor(w.y / TILE) * TILE - TILE;
    const s = BUILD_CELL * TILE;
    this.ghost.clear();
    this.ghost.fillStyle(t.valid ? 0x5cb82a : 0xe5473a, 0.25).fillRoundedRect(x, y, s, s, 10);
    this.ghost.lineStyle(3, t.valid ? 0x5cb82a : 0xe5473a, 1).strokeRoundedRect(x + 1, y + 1, s - 2, s - 2, 10);
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
    if (modal.open) return;
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
        this.selBox.lineStyle(2, SEA.outline, 0.9).strokeRectShape(r);
        this.selBox.fillStyle(SEA.outline, 0.12).fillRectShape(r);
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
      const { ns, name, kind } = view.dep;
      const cell = t.cell;
      const call = kind === 'StatefulSet' ? workloadApi.setMapPos('StatefulSet', ns, name, { x: cell.x, y: cell.y }) : setMapPos(ns, name, { x: cell.x, y: cell.y });
      call
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
    for (const sv of this.services.values()) {
      if (sv.rect().contains(end.x, end.y)) {
        selection.set([serviceKey(sv.key)]);
        return;
      }
    }
    for (const r of this.releases.values()) {
      if (r.plateRect().contains(end.x, end.y)) {
        selection.set([releaseKey(r.key)]);
        return;
      }
    }
    for (const gt of this.gates.values()) {
      if (gt.rect().contains(end.x, end.y)) {
        selection.set([gateKey(gt.key)]);
        return;
      }
    }
    selection.clear();
  }

  private refreshSelection(): void {
    for (const b of this.buildings.values()) b.setSelected(selection.keys.has(buildingKey(b.key)));
    for (const u of this.units.values()) u.setSelected(selection.keys.has(unitKey(u.key)));
    for (const r of this.releases.values()) r.setSelected(selection.keys.has(releaseKey(r.key)));
    for (const sv of this.services.values()) sv.setSelected(selection.keys.has(serviceKey(sv.key)));
    for (const gt of this.gates.values()) gt.setSelected(selection.keys.has(gateKey(gt.key)));
    this.drawLinks();
  }

  /** Power lines between selected services and their units (either side selected). */
  private drawLinks(): void {
    const g = this.links;
    g.clear();
    const pairs: [ServiceView, UnitView][] = [];
    for (const k of selection.keys) {
      if (k.startsWith('s:')) {
        const sv = this.services.get(k.slice(2));
        if (!sv) continue;
        for (const p of podsForService(sv.svc, store.pods.values())) {
          const u = this.units.get(nsKey(p.ns, p.name));
          if (u && !u.dying) pairs.push([sv, u]);
        }
      } else if (k.startsWith('u:')) {
        const u = this.units.get(k.slice(2));
        if (!u) continue;
        for (const sk of servicesForPod(u.pod, store.services.values())) {
          const sv = this.services.get(sk);
          if (sv) pairs.push([sv, u]);
        }
      }
    }
    for (const [sv, u] of pairs) {
      const a = sv.centre();
      const bx = u.x + TILE / 2;
      const by = u.y + TILE / 2;
      g.lineStyle(5, SEA.beam, 0.35).lineBetween(a.x, a.y, bx, by);
      g.lineStyle(2, 0xffffff, 0.9).lineBetween(a.x, a.y, bx, by);
      g.fillStyle(0xffffff, 1).fillCircle(bx, by, 3);
    }
    // Channels: gate ↔ lighthouse, when either side is selected.
    const channels: [GateView, ServiceView][] = [];
    for (const k of selection.keys) {
      if (k.startsWith('g:')) {
        const gt = this.gates.get(k.slice(2));
        if (!gt) continue;
        for (const sk of servicesForIngress(gt.ing)) {
          const sv = this.services.get(sk);
          if (sv) channels.push([gt, sv]);
        }
      } else if (k.startsWith('s:')) {
        const sv = this.services.get(k.slice(2));
        if (!sv) continue;
        for (const gk of ingressesForService(sv.svc, store.ingresses.values())) {
          const gt = this.gates.get(gk);
          if (gt) channels.push([gt, sv]);
        }
      }
    }
    for (const [gt, sv] of channels) {
      const a = gt.centre();
      const b = sv.centre();
      g.lineStyle(6, 0xffffff, 0.25).lineBetween(a.x, a.y, b.x, b.y);
      g.lineStyle(2, 0xffd166, 0.95).lineBetween(a.x, a.y, b.x, b.y);
      g.fillStyle(0xffd166, 1).fillCircle(b.x, b.y, 3);
    }
  }

  // ---- reconcile ---------------------------------------------------------

  /** Recompute the layout and reconcile every view against the store. */
  private rebuild(): void {
    const show = (ns: string): boolean => namespaceVisible(ns, settings);
    const deployments = [...store.deployments.values()].filter((d) => show(d.ns));
    const pods = [...store.pods.values()].filter((p) => show(p.ns));
    const services = [...store.services.values()].filter((sv) => show(sv.ns));
    const workloads = [...store.workloads.values()].filter((w) => show(w.ns));
    const ingresses = [...store.ingresses.values()].filter((i) => show(i.ns));
    this.layout = computeLayout([...store.nodes.values()], deployments, pods, services, workloads, ingresses);
    const L = this.layout;

    const pad = SEA_PAD * TILE;
    this.cameras.main.setBounds(-pad, -pad, L.width * TILE + 2 * pad, L.height * TILE + 2 * pad);
    this.sea.rebuild(L);

    const liveNodes = new Set<string>();
    for (const pl of L.plateaus) {
      liveNodes.add(pl.node);
      const v = this.plateaus.get(pl.node);
      if (v) v.redraw(pl);
      else this.plateaus.set(pl.node, new DockView(this, pl));
    }
    for (const [k, v] of this.plateaus) {
      if (!liveNodes.has(k)) {
        v.destroy();
        this.plateaus.delete(k);
      }
    }

    const liveDeps = new Set<string>();
    const structures = [
      ...deployments.map((d) => ({ key: nsKey(d.ns, d.name), model: structureOfDeployment(d) })),
      ...workloads.filter((w) => w.kind === 'StatefulSet').map((w) => ({ key: `sts:${nsKey(w.ns, w.name)}`, model: structureOfStatefulSet(w) })),
    ];
    for (const { key, model } of structures) {
      const place = L.buildings.get(key);
      if (!place) continue;
      liveDeps.add(key);
      const v = this.buildings.get(key);
      if (v) v.update(model, place);
      else this.buildings.set(key, new BuildingView(this, key, model, place));
    }
    for (const [k, v] of this.buildings) {
      if (!liveDeps.has(k)) {
        if (this.dragBuilding?.view === v) this.dragBuilding = undefined;
        v.destroy();
        this.buildings.delete(k);
      }
    }

    // Release perimeters.
    const liveRels = new Set<string>();
    for (const [key, box] of L.releases) {
      liveRels.add(key);
      const rel = store.releases.get(key);
      const v = this.releases.get(key);
      if (v) v.update(box, rel);
      else this.releases.set(key, new ReleaseView(this, box, rel));
    }
    for (const [k, v] of this.releases) {
      if (!liveRels.has(k)) {
        v.destroy();
        this.releases.delete(k);
      }
    }

    // Services.
    const liveSvcs = new Set<string>();
    for (const sv of services) {
      const key = nsKey(sv.ns, sv.name);
      const place = L.services.get(key);
      if (!place) continue;
      liveSvcs.add(key);
      const v = this.services.get(key);
      if (v) v.update(sv, place);
      else this.services.set(key, new ServiceView(this, key, sv, place));
    }
    for (const [k, v] of this.services) {
      if (!liveSvcs.has(k)) {
        v.destroy();
        this.services.delete(k);
      }
    }

    // Gates in the breakwater.
    const liveGates = new Set<string>();
    for (const ing of ingresses) {
      const key = nsKey(ing.ns, ing.name);
      const place = L.gates.get(key);
      if (!place) continue;
      liveGates.add(key);
      const v = this.gates.get(key);
      if (v) v.update(ing, place);
      else this.gates.set(key, new GateView(this, key, ing, place));
    }
    for (const [k, v] of this.gates) {
      if (!liveGates.has(k)) {
        v.destroy();
        this.gates.delete(k);
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
        const sk = structureKeyOf(p);
        const building = sk ? this.buildings.get(sk) : undefined;
        const from = this.initialised && building ? building.door() : undefined;
        this.units.set(key, new UnitView(this, key, p, place, from));
        if (from) {
          splash(this, from.x + TILE / 2, from.y + TILE / 2);
          floatText(this, from.x + TILE / 2, from.y - 6, '⚓ launched');
        }
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
      if (kind === 'b') return !liveDeps.has(key);
      if (kind === 'r') return !liveRels.has(key);
      if (kind === 's') return !liveSvcs.has(key);
      if (kind === 'w') return !store.workloads.has(key);
      if (kind === 'g') return !liveGates.has(key);
      return !livePods.has(key);
    });
    if (stale.length) selection.set([...selection.keys].filter((k) => !stale.includes(k)));
    this.refreshSelection();
    this.initialised = true;
  }

}
