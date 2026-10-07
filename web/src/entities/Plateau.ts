import Phaser from 'phaser';
import { FONT, PALETTE } from '../config';
import { TILE, type PlateauLayout } from '../layout/grid';

/** A node: a plateau of buildable land. Dark red when NotReady. */
export class PlateauView extends Phaser.GameObjects.Container {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, layout: PlateauLayout) {
    super(scene, layout.x * TILE, layout.y * TILE);
    this.g = scene.add.graphics();
    this.label = scene.add.text(6, 3, '', { fontFamily: FONT, fontSize: '10px', color: '#d8d0a0' });
    this.add([this.g, this.label]);
    this.setDepth(-5);
    scene.add.existing(this);
    this.redraw(layout);
  }

  redraw(layout: PlateauLayout): void {
    this.setPosition(layout.x * TILE, layout.y * TILE);
    const w = layout.w * TILE;
    const h = layout.h * TILE;
    this.g.clear();
    this.g.fillStyle(layout.ready ? PALETTE.plateau : PALETTE.plateauDown, 1);
    this.g.fillRect(0, 0, w, h);
    // Faint tile grid so placement reads as cells.
    this.g.lineStyle(1, 0x000000, 0.12);
    for (let x = TILE; x < w; x += TILE) this.g.lineBetween(x, 0, x, h);
    for (let y = TILE; y < h; y += TILE) this.g.lineBetween(0, y, w, y);
    // Cliff edge.
    this.g.lineStyle(3, layout.ready ? PALETTE.cliff : 0x7a3a3a, 1);
    this.g.strokeRect(1.5, 1.5, w - 3, h - 3);
    this.label.setText(layout.ready ? layout.node.toUpperCase() : `${layout.node.toUpperCase()}  [NOT READY]`);
    this.label.setColor(layout.ready ? '#d8d0a0' : '#ff6a6a');
  }
}
