import Phaser from 'phaser';
import { MAP_FONT, SEA } from '../config';
import { ATLAS, SPRITES, TILES } from '../gfx/manifest';
import { hexString, namespaceColor } from '../layout/colors';
import { BUILD_CELL, TILE, TILE_SCALE, type Placement } from '../layout/grid';
import type { Deployment, Workload } from '../store/cluster';

/** What a structure needs to draw itself; Deployments and StatefulSets both fit. */
export interface StructureModel {
  kind: 'Deployment' | 'StatefulSet';
  ns: string;
  name: string;
  image: string;
  replicas: number;
  available: number;
  updated: number;
  mapPos?: { x: number; y: number };
}

export function structureOfDeployment(d: Deployment): StructureModel {
  return { kind: 'Deployment', ns: d.ns, name: d.name, image: d.image, replicas: d.replicas, available: d.available, updated: d.updated, ...(d.mapPos ? { mapPos: d.mapPos } : {}) };
}

export function structureOfStatefulSet(w: Workload): StructureModel {
  return { kind: 'StatefulSet', ns: w.ns, name: w.name, image: w.image, replicas: w.desired, available: w.ready, updated: w.desired, ...(w.mapPos ? { mapPos: w.mapPos } : {}) };
}

const CELL_PX = BUILD_CELL * TILE; // 96
export const BUILDING_PX = CELL_PX;

/** A Deployment (shipyard) or StatefulSet (tanker terminal): a slipway with a hull and crates. */
export class BuildingView extends Phaser.GameObjects.Container {
  readonly key: string;
  dep: StructureModel;
  placement: Placement;

  private readonly slip: Phaser.GameObjects.Graphics;
  private readonly hull: Phaser.GameObjects.Image;
  private readonly crates: Phaser.GameObjects.Image[];
  private readonly flag: Phaser.GameObjects.Image;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly sel: Phaser.GameObjects.Graphics;
  private readonly hit: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly status: Phaser.GameObjects.Text;
  private readonly rollout: Phaser.GameObjects.Text;
  private flashUntil = 0;

  constructor(scene: Phaser.Scene, key: string, dep: StructureModel, placement: Placement) {
    super(scene, placement.x * TILE, placement.y * TILE);
    this.key = key;
    this.dep = dep;
    this.placement = placement;
    this.slip = scene.add.graphics();
    this.hull = scene.add.image(CELL_PX / 2 + 8, CELL_PX / 2 + 6, ATLAS.ships.key, SPRITES.hullLarge(0).frame).setScale(0.5);
    this.crates = [0, 1, 2].map((i) => scene.add.image(14 + i * 15, CELL_PX - 20, ATLAS.tiles.key, TILES.crate).setScale(TILE_SCALE * 0.6));
    this.flag = scene.add.image(18, 14, ATLAS.ships.key, SPRITES.flag(0).frame).setScale(0.5).setOrigin(0.5, 1);
    this.bar = scene.add.graphics();
    this.sel = scene.add.graphics();
    this.hit = scene.add.graphics();
    this.label = scene.add.text(CELL_PX / 2, CELL_PX + 1, '', { fontFamily: MAP_FONT, fontSize: '11px', fontStyle: '800', color: '#ffffff', stroke: '#1d5f87', strokeThickness: 3 }).setOrigin(0.5, 0);
    this.status = scene.add.text(CELL_PX / 2 + 8, CELL_PX / 2 + 4, '', { fontFamily: MAP_FONT, fontSize: '12px', fontStyle: '900', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5);
    this.rollout = scene.add.text(CELL_PX - 6, 4, 'REFIT', { fontFamily: MAP_FONT, fontSize: '9px', fontStyle: '900', color: '#ffd166', stroke: '#000000', strokeThickness: 3 }).setOrigin(1, 0).setVisible(false);
    this.add([this.slip, this.hull, ...this.crates, this.flag, this.bar, this.sel, this.hit, this.label, this.status, this.rollout]);
    this.setDepth(10);
    scene.add.existing(this);
    this.redraw();
  }

  /** Launch point: the slipway's foot, where new ships appear (world px). */
  door(): { x: number; y: number } {
    return { x: this.x + CELL_PX / 2 - TILE / 2, y: this.y + CELL_PX - TILE / 2 };
  }

  rect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(this.x + 4, this.y + 4, CELL_PX - 8, CELL_PX - 8);
  }

  update(dep: StructureModel, placement: Placement): void {
    this.dep = dep;
    const moved = placement.x !== this.placement.x || placement.y !== this.placement.y;
    this.placement = placement;
    if (moved) this.scene.tweens.add({ targets: this, x: placement.x * TILE, y: placement.y * TILE, duration: 400, ease: 'Quad.easeOut' });
    this.redraw();
  }

  setSelected(on: boolean): void {
    this.sel.clear();
    if (on) this.sel.lineStyle(3, SEA.outline, 1).strokeRoundedRect(2, 2, CELL_PX - 4, CELL_PX - 4, 10);
  }

  flash(now: number): void {
    this.flashUntil = now + 900;
  }

  tick(time: number): void {
    const building = this.dep.available === 0 && this.dep.replicas > 0;
    this.hull.setAlpha(building ? (Math.floor(time / 350) % 2 === 0 ? 0.9 : 0.4) : 1);
    this.hit.setVisible(time < this.flashUntil && Math.floor(time / 120) % 2 === 0);
    this.flag.setScale(0.5 + Math.sin(time / 250) * 0.03, 0.5);
  }

  private redraw(): void {
    const color = namespaceColor(this.dep.ns);
    const g = this.slip;
    const terminal = this.dep.kind === 'StatefulSet';
    g.clear();
    // Shipyard: timber slipway. Tanker terminal: concrete apron with a tank farm.
    g.fillStyle(terminal ? 0x6f7470 : 0x6b4a2b, 1).fillRoundedRect(22, 16, CELL_PX - 36, CELL_PX - 30, 6);
    g.fillStyle(terminal ? 0x8c918d : 0x8a6239, 1);
    for (let y = 22; y < CELL_PX - 20; y += 10) g.fillRect(26, y, CELL_PX - 44, 4);
    if (terminal) {
      g.fillStyle(0xd9dcd8, 1).fillCircle(32, 28, 7).fillCircle(32, 46, 7);
      g.lineStyle(2, 0x4a4f4c, 1).strokeCircle(32, 28, 7).strokeCircle(32, 46, 7);
    }
    g.lineStyle(3, terminal ? 0xe8e8e0 : 0xd9c79a, 1).strokeRoundedRect(22, 16, CELL_PX - 36, CELL_PX - 30, 6);
    this.hull.setTexture(ATLAS.ships.key, SPRITES.hullLarge(terminal ? 1 : 0).frame);
    this.flag.setTint(color);
    const frac = this.dep.replicas > 0 ? Math.min(1, this.dep.available / this.dep.replicas) : 1;
    const barColor = frac >= 1 ? 0x5cb82a : frac > 0 ? 0xe8b33a : 0xe5473a;
    this.bar.clear();
    this.bar.fillStyle(0x1d2a12, 0.85).fillRoundedRect(8, -10, CELL_PX - 16, 8, 4);
    this.bar.fillStyle(barColor, 1).fillRoundedRect(9, -9, Math.max(0, (CELL_PX - 18) * frac), 6, 3);
    this.hit.clear();
    this.hit.lineStyle(3, 0xe5473a, 1).strokeRoundedRect(2, 2, CELL_PX - 4, CELL_PX - 4, 10).setVisible(false);
    this.label.setText(this.dep.name.length > 14 ? `${this.dep.name.slice(0, 13)}…` : this.dep.name).setColor(hexString(color));
    this.status.setText(`${this.dep.available}/${this.dep.replicas}`);
    this.rollout.setVisible(this.dep.replicas > 0 && this.dep.updated < this.dep.replicas);
    const visible = Math.min(3, this.dep.replicas);
    this.crates.forEach((c, i) => c.setVisible(i < visible));
  }
}
