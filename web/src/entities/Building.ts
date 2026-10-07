import Phaser from 'phaser';
import { FONT, PALETTE } from '../config';
import { TEX } from '../gfx/sprites';
import { hexString, namespaceColor } from '../layout/colors';
import { BUILD_CELL, TILE, type Placement } from '../layout/grid';
import type { Deployment } from '../store/cluster';

const CELL_PX = BUILD_CELL * TILE; // 72
const PAD = 4;
export const BUILDING_PX = CELL_PX;

/** A Deployment: the War Factory that produces pod units. */
export class BuildingView extends Phaser.GameObjects.Container {
  readonly key: string;
  dep: Deployment;
  placement: Placement;

  private readonly base: Phaser.GameObjects.Image;
  private readonly accent: Phaser.GameObjects.Image;
  private readonly scaffold: Phaser.GameObjects.Image;
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly sel: Phaser.GameObjects.Graphics;
  private readonly hit: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly status: Phaser.GameObjects.Text;
  private readonly rollout: Phaser.GameObjects.Text;
  private flashUntil = 0;

  constructor(scene: Phaser.Scene, key: string, dep: Deployment, placement: Placement) {
    super(scene, placement.x * TILE, placement.y * TILE);
    this.key = key;
    this.dep = dep;
    this.placement = placement;
    this.base = scene.add.image(PAD, PAD, TEX.factoryBase).setOrigin(0);
    this.accent = scene.add.image(PAD, PAD, TEX.factoryAccent).setOrigin(0);
    this.scaffold = scene.add.image(PAD, PAD, TEX.scaffold).setOrigin(0).setVisible(false);
    this.bars = scene.add.graphics();
    this.sel = scene.add.graphics();
    this.hit = scene.add.graphics();
    this.hit.lineStyle(3, PALETTE.alert, 1).strokeRect(PAD, PAD, CELL_PX - 2 * PAD, CELL_PX - 2 * PAD).setVisible(false);
    this.label = scene.add.text(CELL_PX / 2, CELL_PX - 2, '', { fontFamily: FONT, fontSize: '9px', color: '#e8e8d0' }).setOrigin(0.5, 0);
    this.status = scene.add.text(CELL_PX / 2, CELL_PX / 2 + 2, '', { fontFamily: FONT, fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5);
    this.rollout = scene.add.text(CELL_PX - PAD - 2, PAD + 2, 'ROLLOUT', { fontFamily: FONT, fontSize: '7px', color: hexString(PALETTE.amber), stroke: '#000000', strokeThickness: 2 }).setOrigin(1, 0).setVisible(false);
    this.add([this.base, this.accent, this.scaffold, this.bars, this.sel, this.hit, this.label, this.status, this.rollout]);
    this.setDepth(10);
    scene.add.existing(this);
    this.redraw();
  }

  /** Door: where new units roll out from (world px). */
  door(): { x: number; y: number } {
    return { x: this.x + CELL_PX / 2 - TILE / 2, y: this.y + CELL_PX - 22 };
  }

  rect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(this.x + PAD, this.y + PAD, CELL_PX - 2 * PAD, CELL_PX - 2 * PAD);
  }

  update(dep: Deployment, placement: Placement): void {
    this.dep = dep;
    const moved = placement.x !== this.placement.x || placement.y !== this.placement.y;
    this.placement = placement;
    if (moved) {
      this.scene.tweens.add({ targets: this, x: placement.x * TILE, y: placement.y * TILE, duration: 400, ease: 'Quad.easeOut' });
    }
    this.redraw();
  }

  setSelected(on: boolean): void {
    this.sel.clear();
    if (!on) return;
    this.sel.lineStyle(2, PALETTE.radarGreen, 1);
    const s = CELL_PX;
    const c = 10;
    this.sel.lineBetween(0, c, 0, 0).lineBetween(0, 0, c, 0);
    this.sel.lineBetween(s - c, 0, s, 0).lineBetween(s, 0, s, c);
    this.sel.lineBetween(0, s - c, 0, s).lineBetween(0, s, c, s);
    this.sel.lineBetween(s - c, s, s, s).lineBetween(s, s, s, s - c);
  }

  /** Red flash for a Warning event aimed at this structure. */
  flash(now: number): void {
    this.flashUntil = now + 900;
  }

  /** Per-frame: scaffold blink while nothing is available; event flash. */
  tick(time: number): void {
    const building = this.dep.available === 0 && this.dep.replicas > 0;
    this.scaffold.setVisible(building && Math.floor(time / 300) % 2 === 0);
    this.hit.setVisible(time < this.flashUntil && Math.floor(time / 120) % 2 === 0);
  }

  private redraw(): void {
    const color = namespaceColor(this.dep.ns);
    const s = CELL_PX - 2 * PAD;
    this.accent.setTint(color);
    const frac = this.dep.replicas > 0 ? Math.min(1, this.dep.available / this.dep.replicas) : 1;
    const barColor = frac >= 1 ? PALETTE.radarGreen : frac > 0 ? PALETTE.amber : PALETTE.alert;
    this.bars.clear();
    this.bars.fillStyle(0x000000, 1).fillRect(PAD, -6, s, 5);
    this.bars.fillStyle(barColor, 1).fillRect(PAD + 1, -5, Math.max(0, (s - 2) * frac), 3);
    this.label.setText(this.dep.name.length > 12 ? `${this.dep.name.slice(0, 11)}…` : this.dep.name);
    this.label.setColor(hexString(color));
    this.status.setText(`${this.dep.available}/${this.dep.replicas}`).setColor(hexString(barColor));
    this.rollout.setVisible(this.dep.replicas > 0 && this.dep.updated < this.dep.replicas);
  }
}
