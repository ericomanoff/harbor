import Phaser from 'phaser';
import { FONT, PALETTE } from '../config';
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

  private readonly shape: Phaser.GameObjects.Graphics;
  private readonly blink: Phaser.GameObjects.Graphics;
  private readonly sel: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly status: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, key: string, dep: Deployment, placement: Placement) {
    super(scene, placement.x * TILE, placement.y * TILE);
    this.key = key;
    this.dep = dep;
    this.placement = placement;
    this.shape = scene.add.graphics();
    this.blink = scene.add.graphics();
    this.sel = scene.add.graphics();
    this.label = scene.add.text(CELL_PX / 2, CELL_PX - 2, '', { fontFamily: FONT, fontSize: '9px', color: '#e8e8d0' }).setOrigin(0.5, 0);
    this.status = scene.add.text(CELL_PX / 2, CELL_PX / 2, '', { fontFamily: FONT, fontSize: '12px', color: '#ffffff' }).setOrigin(0.5);
    this.add([this.shape, this.blink, this.sel, this.label, this.status]);
    this.setDepth(10);
    scene.add.existing(this);
    this.redraw();
  }

  /** Door: where new units roll out from (world px). */
  door(): { x: number; y: number } {
    return { x: this.x + CELL_PX / 2 - 8, y: this.y + CELL_PX - 20 };
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
    // Corner brackets, C&C style.
    this.sel.lineBetween(0, c, 0, 0).lineBetween(0, 0, c, 0);
    this.sel.lineBetween(s - c, 0, s, 0).lineBetween(s, 0, s, c);
    this.sel.lineBetween(0, s - c, 0, s).lineBetween(0, s, c, s);
    this.sel.lineBetween(s - c, s, s, s).lineBetween(s, s, s, s - c);
  }

  /** Per-frame: construction blink while no replica is available. */
  tick(time: number): void {
    const building = this.dep.available === 0 && this.dep.replicas > 0;
    this.blink.setVisible(building && Math.floor(time / 300) % 2 === 0);
  }

  private redraw(): void {
    const color = namespaceColor(this.dep.ns);
    const s = CELL_PX - 2 * PAD;
    this.shape.clear();
    this.shape.fillStyle(0x1e1e18, 1);
    this.shape.fillRect(PAD, PAD, s, s);
    this.shape.lineStyle(3, color, 1);
    this.shape.strokeRect(PAD + 1.5, PAD + 1.5, s - 3, s - 3);
    // Roof detail and door.
    this.shape.fillStyle(color, 0.35);
    this.shape.fillRect(PAD + 6, PAD + 6, s - 12, 14);
    this.shape.fillStyle(0x000000, 1);
    this.shape.fillRect(CELL_PX / 2 - 8, CELL_PX - PAD - 14, 16, 12);
    // Health bar: available / desired.
    const frac = this.dep.replicas > 0 ? Math.min(1, this.dep.available / this.dep.replicas) : 1;
    const barColor = frac >= 1 ? PALETTE.radarGreen : frac > 0 ? PALETTE.amber : PALETTE.alert;
    this.shape.fillStyle(0x000000, 1);
    this.shape.fillRect(PAD, -6, s, 5);
    this.shape.fillStyle(barColor, 1);
    this.shape.fillRect(PAD + 1, -5, Math.max(0, (s - 2) * frac), 3);

    this.blink.clear();
    this.blink.lineStyle(2, PALETTE.amber, 1);
    this.blink.strokeRect(PAD + 5, PAD + 5, s - 10, s - 10);
    this.blink.setVisible(false);

    this.label.setText(this.dep.name.length > 12 ? `${this.dep.name.slice(0, 11)}…` : this.dep.name);
    this.label.setColor(hexString(color));
    this.status.setText(`${this.dep.available}/${this.dep.replicas}`);
    this.status.setColor(hexString(barColor));
  }
}
