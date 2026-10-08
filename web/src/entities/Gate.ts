import Phaser from 'phaser';
import { MAP_FONT, SEA } from '../config';
import { ATLAS, TILES } from '../gfx/manifest';
import { hexString, namespaceColor } from '../layout/colors';
import { GATE_W, TILE, TILE_SCALE, type Placement } from '../layout/grid';
import type { Ingress } from '../store/cluster';

const W = GATE_W * TILE;

/** An Ingress: a gate in the breakwater at the harbor mouth, two towers and a chain. */
export class GateView extends Phaser.GameObjects.Container {
  readonly key: string;
  ing: Ingress;
  placement: Placement;

  private readonly left: Phaser.GameObjects.Image;
  private readonly right: Phaser.GameObjects.Image;
  private readonly chain: Phaser.GameObjects.Graphics;
  private readonly sel: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly lamp: Phaser.GameObjects.Arc;

  constructor(scene: Phaser.Scene, key: string, ing: Ingress, placement: Placement) {
    super(scene, placement.x * TILE, placement.y * TILE);
    this.key = key;
    this.ing = ing;
    this.placement = placement;
    this.chain = scene.add.graphics();
    this.left = scene.add.image(TILE / 2, TILE / 2, ATLAS.tiles.key, TILES.tower).setScale(TILE_SCALE * 1.2);
    this.right = scene.add.image(W - TILE / 2, TILE / 2, ATLAS.tiles.key, TILES.tower).setScale(TILE_SCALE * 1.2);
    this.lamp = scene.add.circle(W / 2, TILE / 2 - 10, 3, 0xfff3a0, 1);
    this.sel = scene.add.graphics();
    this.label = scene.add.text(W / 2, -16, '', { fontFamily: MAP_FONT, fontSize: '10px', fontStyle: '800', color: '#ffffff', stroke: '#1d5f87', strokeThickness: 3 }).setOrigin(0.5, 1);
    this.add([this.chain, this.left, this.right, this.lamp, this.sel, this.label]);
    this.setDepth(17);
    scene.add.existing(this);
    this.redraw();
  }

  /** Where channel lines start (world px). */
  centre(): { x: number; y: number } {
    return { x: this.x + W / 2, y: this.y + TILE / 2 };
  }

  rect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(this.x, this.y - 18, W, TILE + 18);
  }

  update(ing: Ingress, placement: Placement): void {
    this.ing = ing;
    const moved = placement.x !== this.placement.x || placement.y !== this.placement.y;
    this.placement = placement;
    if (moved) this.scene.tweens.add({ targets: this, x: placement.x * TILE, y: placement.y * TILE, duration: 400 });
    this.redraw();
  }

  setSelected(on: boolean): void {
    this.sel.clear();
    if (on) this.sel.lineStyle(2, SEA.outline, 1).strokeRoundedRect(-2, -2, W + 4, TILE + 4, 8);
  }

  tick(time: number): void {
    this.lamp.setAlpha(0.5 + 0.5 * Math.abs(Math.sin(time / 500)));
  }

  private redraw(): void {
    const color = namespaceColor(this.ing.ns);
    const g = this.chain;
    g.clear();
    // Chain across the mouth, sagging a little; gold when TLS guards the gate.
    g.lineStyle(3, this.ing.tls ? 0xe8b33a : 0x6b6b6b, 1);
    g.beginPath();
    g.moveTo(TILE - 4, TILE / 2);
    g.lineTo(W / 2, TILE / 2 + 6);
    g.lineTo(W - TILE + 4, TILE / 2);
    g.strokePath();
    for (let x = TILE; x < W - TILE; x += 6) g.fillStyle(0x3a3a3a, 1).fillCircle(x, TILE / 2 + 3 + Math.sin((x / W) * Math.PI) * 3, 1.5);
    const host = this.ing.hosts[0] ?? this.ing.name;
    const more = this.ing.hosts.length > 1 ? ` +${this.ing.hosts.length - 1}` : '';
    this.label.setText(`${this.ing.tls ? '🔒 ' : ''}${host.length > 22 ? `${host.slice(0, 21)}…` : host}${more}`).setColor(hexString(color));
  }
}
