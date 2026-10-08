import Phaser from 'phaser';
import { FONT, PALETTE } from '../config';
import { TEX } from '../gfx/sprites';
import { hexString, namespaceColor } from '../layout/colors';
import { TILE, type Placement } from '../layout/grid';
import type { Service } from '../store/cluster';

/** A Service: a radar dish whose power lines run to the units it routes to. */
export class ServiceView extends Phaser.GameObjects.Container {
  readonly key: string;
  svc: Service;
  placement: Placement;

  private readonly dish: Phaser.GameObjects.Sprite;
  private readonly sel: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, key: string, svc: Service, placement: Placement) {
    super(scene, placement.x * TILE, placement.y * TILE);
    this.key = key;
    this.svc = svc;
    this.placement = placement;
    this.dish = scene.add.sprite(TILE / 2, TILE / 2, TEX.dish);
    this.sel = scene.add.graphics();
    this.label = scene.add.text(TILE / 2, TILE + 1, '', { fontFamily: FONT, fontSize: '8px', color: '#ffffff' }).setOrigin(0.5, 0);
    this.add([this.dish, this.sel, this.label]);
    this.setDepth(18);
    scene.add.existing(this);
    this.redraw();
  }

  /** Where power lines attach (world px). */
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
    if (on) this.sel.lineStyle(1, PALETTE.radarGreen, 1).strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
  }

  /** Dish sweep. */
  tick(time: number): void {
    this.dish.setRotation(Math.sin(time / 600) * 0.6);
  }

  private redraw(): void {
    const color = namespaceColor(this.svc.ns);
    this.dish.setTint(color);
    this.label.setText(this.svc.name.length > 10 ? `${this.svc.name.slice(0, 9)}…` : this.svc.name).setColor(hexString(color));
  }
}
