import Phaser from 'phaser';
import { MAP_FONT, SEA } from '../config';
import { ATLAS, TILES } from '../gfx/manifest';
import { hexString, namespaceColor } from '../layout/colors';
import { TILE, TILE_SCALE, type Placement } from '../layout/grid';
import type { Service } from '../store/cluster';

/** A Service: a lighthouse whose beam reaches the ships it routes to. */
export class ServiceView extends Phaser.GameObjects.Container {
  readonly key: string;
  svc: Service;
  placement: Placement;

  private readonly tower: Phaser.GameObjects.Image;
  private readonly beam: Phaser.GameObjects.Graphics;
  private readonly sel: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly lamp: Phaser.GameObjects.Arc;

  constructor(scene: Phaser.Scene, key: string, svc: Service, placement: Placement) {
    super(scene, placement.x * TILE, placement.y * TILE);
    this.key = key;
    this.svc = svc;
    this.placement = placement;
    this.beam = scene.add.graphics();
    this.tower = scene.add.image(TILE / 2, TILE / 2, ATLAS.tiles.key, TILES.tower).setScale(TILE_SCALE * 1.15);
    this.lamp = scene.add.circle(TILE / 2, TILE / 2 - 2, 3, 0xfff3a0, 1);
    this.sel = scene.add.graphics();
    this.label = scene.add.text(TILE / 2, TILE + 1, '', { fontFamily: MAP_FONT, fontSize: '10px', fontStyle: '800', color: '#ffffff', stroke: '#1d5f87', strokeThickness: 3 }).setOrigin(0.5, 0);
    this.add([this.beam, this.tower, this.lamp, this.sel, this.label]);
    this.setDepth(18);
    scene.add.existing(this);
    this.redraw();
  }

  centre(): { x: number; y: number } {
    return { x: this.x + TILE / 2, y: this.y + TILE / 2 };
  }

  rect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(this.x, this.y, TILE, TILE);
  }

  update(svc: Service, placement: Placement): void {
    this.svc = svc;
    const moved = placement.x !== this.placement.x || placement.y !== this.placement.y;
    this.placement = placement;
    if (moved) this.scene.tweens.add({ targets: this, x: placement.x * TILE, y: placement.y * TILE, duration: 400 });
    this.redraw();
  }

  setSelected(on: boolean): void {
    this.sel.clear();
    if (on) this.sel.lineStyle(2, SEA.outline, 1).strokeCircle(TILE / 2, TILE / 2, TILE / 2 + 2);
  }

  /** A slow sweeping light. */
  tick(time: number): void {
    const a = time / 1500;
    const g = this.beam;
    g.clear();
    g.fillStyle(SEA.beam, 0.22);
    g.slice(TILE / 2, TILE / 2, TILE * 1.8, a, a + 0.5, false).fillPath();
    this.lamp.setAlpha(0.6 + 0.4 * Math.sin(time / 300)).setScale(1 + 0.3 * Math.sin(time / 300));
  }

  private redraw(): void {
    const color = namespaceColor(this.svc.ns);
    this.label.setText(this.svc.name.length > 12 ? `${this.svc.name.slice(0, 11)}…` : this.svc.name).setColor(hexString(color));
  }
}
