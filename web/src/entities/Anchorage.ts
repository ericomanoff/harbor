import Phaser from 'phaser';
import { MAP_FONT } from '../config';
import { TILE, type ReleaseBox } from '../layout/grid';
import type { HelmRelease } from '../store/cluster';

const INSET = 6;
const BUOY_EVERY = 28;

function statusColor(status: string | undefined): number {
  switch (status) {
    case 'deployed': return 0x5cb82a;
    case 'failed': return 0xe5473a;
    case undefined: return 0xc9c3b2;
    default: return 0xe8b33a;
  }
}

/** A Helm release: a mooring boom of rope and buoys around its shipyards, with a nameplate. */
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
    this.label = scene.add.text(8, -21, '', { fontFamily: MAP_FONT, fontSize: '11px', fontStyle: '900', color: '#2d3319' });
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

  plateRect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(this.x, this.y - 26, this.label.width + 16, 22);
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
    const x0 = -INSET;
    const y0 = -INSET;
    const x1 = w + INSET;
    const y1 = h + INSET;
    g.lineStyle(this.selected ? 3 : 2, 0xffffff, 0.9).strokeRoundedRect(x0, y0, x1 - x0, y1 - y0, 8);
    g.lineStyle(1, color, 1).strokeRoundedRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2, 7);
    const buoy = (x: number, y: number): void => {
      g.fillStyle(0xffffff, 1).fillCircle(x, y, 4);
      g.fillStyle(color, 1).fillCircle(x, y, 2.5);
    };
    for (let x = x0; x <= x1; x += BUOY_EVERY) {
      buoy(x, y0);
      buoy(x, y1);
    }
    for (let y = y0 + BUOY_EVERY; y < y1; y += BUOY_EVERY) {
      buoy(x0, y);
      buoy(x1, y);
    }
    const status = this.rel?.status ?? 'unknown';
    const rev = this.rel ? ` · r${this.rel.revision}` : '';
    this.label.setText(`⚓ ${this.box.name}${rev} · ${status}`);
    this.plate.clear();
    this.plate.fillStyle(0xf6efdc, 1).fillRoundedRect(0, -26, this.label.width + 16, 22, 8);
    this.plate.lineStyle(2, this.selected ? 0xffffff : color, 1).strokeRoundedRect(0, -26, this.label.width + 16, 22, 8);
  }
}
