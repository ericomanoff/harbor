import Phaser from 'phaser';
import { MAP_FONT, SEA } from '../config';
import { ATLAS, TILES } from '../gfx/manifest';
import { hashString } from '../layout/hash';
import { TILE, TILE_SCALE, TILE_SRC, dockLandRect, dockLandRows, type PlateauLayout } from '../layout/grid';

/**
 * A node: an island. Land (sand with a grass heart) where shipyards stand,
 * a plank quay, and shallows below it where ships moor. Drawn once into a
 * render texture at pack resolution and shown at half scale.
 */
export class DockView extends Phaser.GameObjects.Container {
  private layout: PlateauLayout;
  private readonly rt: Phaser.GameObjects.RenderTexture;
  private readonly label: Phaser.GameObjects.Text;
  private readonly beacon: Phaser.GameObjects.Arc;
  private readonly pier: Phaser.GameObjects.Graphics;
  private readonly sel: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, layout: PlateauLayout) {
    super(scene, layout.x * TILE, layout.y * TILE);
    this.layout = layout;
    this.rt = scene.add.renderTexture(0, 0, layout.w * TILE_SRC, layout.h * TILE_SRC).setOrigin(0).setScale(TILE_SCALE);
    this.label = scene.add.text(10, -16, '', { fontFamily: MAP_FONT, fontSize: '12px', fontStyle: '900', color: '#ffffff', stroke: '#1d5f87', strokeThickness: 4 });
    this.beacon = scene.add.circle(layout.w * TILE - 12, -8, 5, 0xe5473a).setVisible(false);
    this.pier = scene.add.graphics();
    this.sel = scene.add.graphics();
    this.add([this.rt, this.pier, this.sel, this.label, this.beacon]);
    this.setDepth(-10);
    scene.add.existing(this);
    this.redraw(layout);
  }

  /** Rows of land: margin row + building rows + the quay row. */
  static landRows(): number {
    return dockLandRows();
  }

  get node(): string {
    return this.layout.node;
  }

  /** The land, quay and name label in world px: what hovers and clicks. Ships in the shallows keep the pointer. */
  landRect(): Phaser.Geom.Rectangle {
    const r = dockLandRect(this.layout);
    return new Phaser.Geom.Rectangle(r.x, r.y, r.w, r.h);
  }

  /** The same outline every selected object wears, around the land and quay. */
  setSelected(on: boolean): void {
    this.sel.clear();
    if (on) this.sel.lineStyle(3, SEA.outline, 1).strokeRoundedRect(2, 2, this.layout.w * TILE - 4, dockLandRows() * TILE - 4, 8);
  }

  private drawnKey = '';

  redraw(layout: PlateauLayout): void {
    const sizeChanged = layout.w !== this.layout.w || layout.h !== this.layout.h;
    this.layout = layout;
    this.setPosition(layout.x * TILE, layout.y * TILE);
    // The island only changes with size or readiness; skip the (expensive)
    // render-texture pass otherwise. Store churn calls redraw constantly.
    const key = `${layout.node}|${layout.w}x${layout.h}|${layout.ready}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    if (sizeChanged) this.rt.setSize(layout.w * TILE_SRC, layout.h * TILE_SRC);
    this.rt.clear();
    const land = DockView.landRows();
    const S = TILE_SRC;
    const draw = (frame: number, tx: number, ty: number): void => {
      this.rt.drawFrame(ATLAS.tiles.key, frame, tx * S, ty * S);
    };
    for (let ty = 0; ty < layout.h; ty++) {
      for (let tx = 0; tx < layout.w; tx++) {
        if (ty < land) {
          const edgeN = ty === 0;
          const edgeS = ty === land - 1;
          const edgeW = tx === 0;
          const edgeE = tx === layout.w - 1;
          let frame: number = TILES.sand;
          if (edgeN && edgeW) frame = 0;
          else if (edgeN && edgeE) frame = 2;
          else if (edgeS && edgeW) frame = 32;
          else if (edgeS && edgeE) frame = 34;
          else if (edgeN) frame = TILES.sandEdgeN;
          else if (edgeS) frame = TILES.sandEdgeS;
          else if (edgeW) frame = TILES.sandEdgeW;
          else if (edgeE) frame = TILES.sandEdgeE;
          else if (ty >= 2 && ty < land - 2 && tx >= 2 && tx < layout.w - 2) frame = TILES.grass;
          draw(frame, tx, ty);
        } else {
          draw(TILES.shallows, tx, ty);
        }
      }
    }
    const seed = hashString(layout.node);
    const bushes = 2 + (seed % 3);
    for (let i = 0; i < bushes; i++) {
      const bx = 2 + ((seed >> (i * 3)) % Math.max(1, layout.w - 4));
      this.rt.drawFrame(ATLAS.tiles.key, TILES.bush, bx * S, (land - 2) * S);
    }
    // Quay: a wooden pier along the shore, with bollards.
    const g = this.pier;
    g.clear();
    const qy = (land - 1) * TILE + TILE * 0.35;
    const qw = (layout.w - 2) * TILE;
    g.fillStyle(0x3b2a18, 0.35).fillRoundedRect(TILE + 2, qy + 4, qw, TILE * 0.9, 4);
    g.fillStyle(0x9c6b3c, 1).fillRoundedRect(TILE, qy, qw, TILE * 0.9, 4);
    g.lineStyle(1, 0x6b4a2b, 0.9);
    for (let x = TILE + 8; x < TILE + qw; x += 10) g.lineBetween(x, qy + 2, x, qy + TILE * 0.9 - 2);
    g.fillStyle(0x4a3421, 1);
    for (let x = TILE + 10; x < TILE + qw; x += 48) g.fillCircle(x, qy + TILE * 0.9 - 2, 3);
    this.rt.setAlpha(layout.ready ? 1 : 0.6);
    this.beacon.setPosition(layout.w * TILE - 12, -8).setVisible(!layout.ready);
    this.label.setText(layout.ready ? layout.node : `${layout.node} · NOT READY`).setColor(layout.ready ? '#ffffff' : '#ffb3ad');
  }

  tick(time: number): void {
    if (this.beacon.visible) this.beacon.setAlpha(Math.floor(time / 400) % 2 === 0 ? 1 : 0.25);
  }
}
