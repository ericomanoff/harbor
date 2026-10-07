import Phaser from 'phaser';
import { FONT, PALETTE } from '../config';
import { hexString } from '../layout/colors';

/**
 * A bevelled sidebar button. Not a Container: Phaser containers need
 * explicit hit areas, so the input goes through a Zone instead.
 */
export class Button {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private readonly zone: Phaser.GameObjects.Zone;
  private enabled = true;
  private hover = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly x: number,
    private readonly y: number,
    private readonly w: number,
    private readonly h: number,
    label: string,
    onClick: () => void,
    private readonly color: number = PALETTE.radarGreen,
  ) {
    this.bg = scene.add.graphics();
    this.text = scene.add.text(x + w / 2, y + h / 2, label, { fontFamily: FONT, fontSize: '10px', color: hexString(color) }).setOrigin(0.5);
    this.zone = scene.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    this.zone.on('pointerover', () => { this.hover = true; this.draw(); });
    this.zone.on('pointerout', () => { this.hover = false; this.draw(); });
    this.zone.on('pointerdown', (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      if (this.enabled && p.leftButtonDown()) onClick();
    });
    this.draw();
  }

  setLabel(s: string): this {
    this.text.setText(s);
    return this;
  }

  setEnabled(on: boolean): this {
    this.enabled = on;
    this.draw();
    return this;
  }

  setVisible(on: boolean): this {
    this.bg.setVisible(on);
    this.text.setVisible(on);
    this.zone.setVisible(on);
    if (on) this.zone.setInteractive();
    else this.zone.disableInteractive();
    return this;
  }

  private draw(): void {
    const g = this.bg;
    g.clear();
    g.fillStyle(this.hover && this.enabled ? 0x1a1a14 : PALETTE.black, 1).fillRect(this.x, this.y, this.w, this.h);
    g.lineStyle(1, PALETTE.bevelLight, 1).lineBetween(this.x, this.y, this.x + this.w, this.y).lineBetween(this.x, this.y, this.x, this.y + this.h);
    g.lineStyle(1, PALETTE.bevelDark, 1).lineBetween(this.x, this.y + this.h, this.x + this.w, this.y + this.h).lineBetween(this.x + this.w, this.y, this.x + this.w, this.y + this.h);
    this.text.setColor(this.enabled ? hexString(this.color) : '#555550');
  }
}
