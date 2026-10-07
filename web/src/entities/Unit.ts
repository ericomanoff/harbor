import Phaser from 'phaser';
import { PALETTE } from '../config';
import { unitState, type UnitState } from '../game/unitState';
import { ANIM, TEX, snapFacing } from '../gfx/sprites';
import { namespaceColor } from '../layout/colors';
import { TILE, type Placement } from '../layout/grid';
import type { Pod } from '../store/cluster';

const SIZE = 16;
const PAD = (TILE - SIZE) / 2;

/** A Pod: a tank parked on its node's plateau, in its namespace's colour. */
export class UnitView extends Phaser.GameObjects.Container {
  readonly key: string;
  pod: Pod;
  placement: Placement;
  dying = false;

  private readonly tank: Phaser.GameObjects.Sprite;
  private readonly fire: Phaser.GameObjects.Sprite;
  private readonly marks: Phaser.GameObjects.Graphics;
  private readonly sel: Phaser.GameObjects.Graphics;
  private readonly hit: Phaser.GameObjects.Graphics;
  private status: UnitState = 'ok';
  private obsolete = false;
  private flashUntil = 0;

  constructor(scene: Phaser.Scene, key: string, pod: Pod, placement: Placement, spawnFrom?: { x: number; y: number }) {
    super(scene, placement.x * TILE, placement.y * TILE);
    this.key = key;
    this.pod = pod;
    this.placement = placement;
    this.tank = scene.add.sprite(TILE / 2, TILE / 2, TEX.tank);
    this.fire = scene.add.sprite(TILE / 2, 2, `${TEX.fire}-0`).setOrigin(0.5, 1).setVisible(false);
    this.marks = scene.add.graphics();
    this.sel = scene.add.graphics();
    this.hit = scene.add.graphics();
    this.hit.fillStyle(PALETTE.alert, 0.6).fillRect(0, 0, TILE, TILE).setVisible(false);
    this.add([this.tank, this.marks, this.fire, this.sel, this.hit]);
    this.setDepth(20);
    scene.add.existing(this);
    // Idle facing varies by name so a parked column does not look stamped.
    this.tank.setRotation(((key.length * 7) % 8) * (Math.PI / 4));
    this.redraw();
    if (spawnFrom) {
      this.setPosition(spawnFrom.x, spawnFrom.y);
      this.driveTo(placement);
    }
  }

  rect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(this.x, this.y, TILE, TILE);
  }

  update(pod: Pod, placement: Placement, obsolete = false): void {
    this.pod = pod;
    this.obsolete = obsolete;
    const moved = placement.x !== this.placement.x || placement.y !== this.placement.y;
    this.placement = placement;
    if (moved) this.driveTo(placement);
    this.redraw();
  }

  /** Red flash for a Warning event aimed at this unit. */
  flash(now: number): void {
    this.flashUntil = now + 900;
  }

  private driveTo(p: Placement): void {
    const tx = p.x * TILE;
    const ty = p.y * TILE;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, tx, ty);
    if (dist > 0) this.tank.setRotation(snapFacing(tx - this.x, ty - this.y) + Math.PI / 2);
    this.scene.tweens.add({
      targets: this,
      x: tx,
      y: ty,
      duration: Phaser.Math.Clamp(dist * 1.5, 250, 1800),
      ease: 'Sine.easeInOut',
    });
  }

  setSelected(on: boolean): void {
    this.sel.clear();
    if (!on) return;
    this.sel.lineStyle(1, PALETTE.radarGreen, 1);
    this.sel.strokeRect(1.5, 1.5, TILE - 3, TILE - 3);
  }

  /** Per-frame blink for pending units and the event flash. */
  tick(time: number): void {
    const phase = Math.floor(time / 250) % 2 === 0;
    this.hit.setVisible(time < this.flashUntil && Math.floor(time / 120) % 2 === 0);
    if (this.status === 'pending') this.tank.setAlpha(phase ? 0.9 : 0.35);
  }

  /** Death: explosion sprite over the wreck, then destroy. */
  die(): void {
    if (this.dying) return;
    this.dying = true;
    this.fire.setVisible(false);
    this.tank.setTint(0x333333);
    const boom = this.scene.add.sprite(this.x + TILE / 2, this.y + TILE / 2, `${TEX.boom}-0`).setDepth(30);
    boom.play(ANIM.boom);
    boom.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => boom.destroy());
    this.scene.tweens.add({ targets: this, alpha: 0, duration: 500, delay: 150, onComplete: () => this.destroy() });
  }

  private redraw(): void {
    const color = namespaceColor(this.pod.ns);
    this.status = unitState(this.pod);
    this.setAlpha(1);
    this.tank.setAlpha(1).setTint(color);
    this.marks.clear();
    this.fire.setVisible(false);
    this.fire.stop();
    switch (this.status) {
      case 'pending':
        this.tank.setTint(Phaser.Display.Color.ValueToColor(color).darken(40).color);
        break;
      case 'ok':
        break;
      case 'notready':
        this.marks.lineStyle(2, PALETTE.amber, 1).strokeRect(PAD + 1, PAD + 1, SIZE - 2, SIZE - 2);
        break;
      case 'crash':
        this.fire.setVisible(true).play(ANIM.fire);
        this.marks.lineStyle(1, PALETTE.alert, 1).strokeRect(PAD + 0.5, PAD + 0.5, SIZE - 1, SIZE - 1);
        break;
      case 'terminating':
        this.setAlpha(0.4);
        break;
      case 'done':
        this.tank.setTint(0x555555);
        break;
    }
    if (this.obsolete) {
      this.marks.lineStyle(1, 0x000000, 0.7);
      for (let i = -SIZE; i < SIZE; i += 4) this.marks.lineBetween(PAD + i, PAD + SIZE, PAD + i + SIZE, PAD);
      this.marks.lineStyle(1, PALETTE.amber, 1).strokeRect(PAD + 0.5, PAD + 0.5, SIZE - 1, SIZE - 1);
    }
  }
}
