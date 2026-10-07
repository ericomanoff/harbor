import Phaser from 'phaser';
import { FONT, PALETTE } from '../config';
import { hexString } from '../layout/colors';
import { TILE, type ReleaseBox } from '../layout/grid';
import type { HelmRelease } from '../store/cluster';

const INSET = 3;
const DASH = 6;

function statusColor(status: string | undefined): number {
  switch (status) {
    case 'deployed': return PALETTE.radarGreen;
    case 'failed': return PALETTE.alert;
    case undefined: return PALETTE.bevelLight;
    default: return PALETTE.amber; // pending-*, uninstalling, superseded
  }
}

/** A Helm release: a dashed base perimeter around its structures, with a nameplate. */
export class ReleaseView extends Phaser.GameObjects.Container {
  readonly key: string;
  box: ReleaseBox;
  rel: HelmRelease | undefined;

  private readonly g: Phaser.GameObjects.Graphics;
  private readonly plate: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private selected = false;

  constructor(scene: Phaser.Scene, box: ReleaseBox, rel: HelmRelease | undefined) {
    super(scene, box.x * TILE, box.y * TILE);
    this.key = box.key;
    this.box = box;
    this.rel = rel;
    this.g = scene.add.graphics();
    this.plate = scene.add.graphics();
    this.label = scene.add.text(2, -15, '', { fontFamily: FONT, fontSize: '10px', color: '#ffffff' });
    this.add([this.g, this.plate, this.label]);
    this.setDepth(5);
    scene.add.existing(this);
    this.redraw();
  }

  update(box: ReleaseBox, rel: HelmRelease | undefined): void {
    this.box = box;
    this.rel = rel;
    this.setPosition(box.x * TILE, box.y * TILE);
    this.redraw();
  }

  /** The nameplate, in world coordinates, is the click target. */
  plateRect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(this.x, this.y - 17, this.label.width + 8, 16);
  }

  setSelected(on: boolean): void {
    this.selected = on;
    this.redraw();
  }

  private redraw(): void {
    const w = this.box.w * TILE;
    const h = this.box.h * TILE;
    const color = statusColor(this.rel?.status);
    const g = this.g;
    g.clear();
    g.lineStyle(this.selected ? 2 : 1, color, 0.9);
    const x0 = -INSET;
    const y0 = -INSET;
    const x1 = w + INSET;
    const y1 = h + INSET;
    for (let x = x0; x < x1; x += DASH * 2) g.lineBetween(x, y0, Math.min(x + DASH, x1), y0).lineBetween(x, y1, Math.min(x + DASH, x1), y1);
    for (let y = y0; y < y1; y += DASH * 2) g.lineBetween(x0, y, x0, Math.min(y + DASH, y1)).lineBetween(x1, y, x1, Math.min(y + DASH, y1));
    const status = this.rel?.status ?? 'unknown';
    const rev = this.rel ? ` r${this.rel.revision}` : '';
    this.label.setText(`⌂ ${this.box.name}${rev} [${status}]`).setColor(hexString(color));
    this.plate.clear();
    this.plate.fillStyle(0x000000, 0.75).fillRect(0, -17, this.label.width + 6, 16);
    this.plate.lineStyle(1, color, this.selected ? 1 : 0.6).strokeRect(0.5, -16.5, this.label.width + 5, 15);
  }
}
