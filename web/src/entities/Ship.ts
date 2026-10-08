import Phaser from 'phaser';
import { SEA } from '../config';
import { unitState, type UnitState } from '../game/unitState';
import { ANIM } from '../gfx/anims';
import { ATLAS, SPRITES } from '../gfx/manifest';
import { hashString } from '../layout/hash';
import { namespaceColor } from '../layout/colors';
import { TILE, type Placement } from '../layout/grid';
import type { Pod } from '../store/cluster';

const SHIP_SCALE = 0.42; // 66x113 frame → ~28x47 px; overhangs its tile, which reads better than a speck

/** Pastel ensign: tint multiplies, so mix toward white to keep hulls readable. */
function ensignTint(color: number): number {
  const c = Phaser.Display.Color.ValueToColor(color);
  const mix = (v: number): number => Math.round(v + (255 - v) * 0.4);
  return Phaser.Display.Color.GetColor(mix(c.red), mix(c.green), mix(c.blue));
}

/** A Pod: a ship in its namespace's colours, moored in the shallows of its dock. */
export class UnitView extends Phaser.GameObjects.Container {
  readonly key: string;
  pod: Pod;
  placement: Placement;
  dying = false;

  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly ship: Phaser.GameObjects.Image;
  private readonly fire: Phaser.GameObjects.Sprite;
  private readonly marks: Phaser.GameObjects.Graphics;
  private readonly sel: Phaser.GameObjects.Graphics;
  private readonly hit: Phaser.GameObjects.Graphics;
  private status: UnitState = 'ok';
  private obsolete = false;
  private flashUntil = 0;
  private readonly bobPhase: number;

  constructor(scene: Phaser.Scene, key: string, pod: Pod, placement: Placement, spawnFrom?: { x: number; y: number }) {
    super(scene, placement.x * TILE, placement.y * TILE);
    this.key = key;
    this.pod = pod;
    this.placement = placement;
    this.bobPhase = (hashString(key) % 100) / 100;
    this.shadow = scene.add.ellipse(TILE / 2, TILE / 2 + 4, 26, 40, 0x000000, 0.18);
    this.ship = scene.add.image(TILE / 2, TILE / 2, ATLAS.ships.key, SPRITES.ship(0, hashString(key) % 4).frame).setScale(SHIP_SCALE);
    this.fire = scene.add.sprite(TILE / 2, TILE / 2 - 2, ATLAS.ships.key, SPRITES.fire[0].frame).setScale(0.45).setOrigin(0.5, 1).setVisible(false);
    this.marks = scene.add.graphics();
    this.sel = scene.add.graphics();
    this.hit = scene.add.graphics();
    this.hit.fillStyle(0xe5473a, 0.5).fillCircle(TILE / 2, TILE / 2, TILE / 2).setVisible(false);
    this.add([this.shadow, this.ship, this.marks, this.fire, this.sel, this.hit]);
    this.setDepth(20);
    scene.add.existing(this);
    this.ship.setRotation(((hashString(key) >> 4) % 8) * (Math.PI / 4));
    this.redraw();
    if (spawnFrom) {
      this.setPosition(spawnFrom.x, spawnFrom.y);
      this.sailTo(placement);
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
    if (moved) this.sailTo(placement);
    this.redraw();
  }

  flash(now: number): void {
    this.flashUntil = now + 900;
  }

  private sailTo(p: Placement): void {
    const tx = p.x * TILE;
    const ty = p.y * TILE;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, tx, ty);
    if (dist > 0) this.ship.setRotation(Math.atan2(ty - this.y, tx - this.x) + Math.PI / 2);
    this.scene.tweens.add({ targets: this, x: tx, y: ty, duration: Phaser.Math.Clamp(dist * 2, 300, 2200), ease: 'Sine.easeInOut' });
  }

  setSelected(on: boolean): void {
    this.sel.clear();
    if (on) this.sel.lineStyle(2, SEA.outline, 1).strokeCircle(TILE / 2, TILE / 2, TILE / 2 + 2);
  }

  /** Bob at anchor, blink while pending, flash on warnings. */
  tick(time: number): void {
    const bob = Math.sin(time / 700 + this.bobPhase * Math.PI * 2);
    this.ship.y = TILE / 2 + bob * 1.2;
    this.hit.setVisible(time < this.flashUntil && Math.floor(time / 120) % 2 === 0);
    if (this.status === 'pending') this.ship.setAlpha(Math.floor(time / 300) % 2 === 0 ? 0.9 : 0.45);
  }

  /** Sinks: explosion, then the hull fades under the waves leaving debris. */
  die(): void {
    if (this.dying) return;
    this.dying = true;
    this.fire.setVisible(false);
    const boom = this.scene.add.sprite(this.x + TILE / 2, this.y + TILE / 2, ATLAS.ships.key, SPRITES.explosion[0].frame).setScale(0.6).setDepth(30);
    boom.play(ANIM.explosion);
    boom.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => boom.destroy());
    const debris = this.scene.add.image(this.x + TILE / 2, this.y + TILE / 2, ATLAS.ships.key, SPRITES.wood(hashString(this.key) % 4).frame).setScale(0.4).setDepth(19).setAlpha(0.9);
    this.scene.tweens.add({ targets: debris, alpha: 0, duration: 4000, delay: 1500, onComplete: () => debris.destroy() });
    this.scene.tweens.add({ targets: this.ship, scaleX: 0.05, scaleY: 0.05, alpha: 0, duration: 700, delay: 150 });
    this.scene.tweens.add({ targets: this, alpha: 0, duration: 800, delay: 200, onComplete: () => this.destroy() });
  }

  private redraw(): void {
    const color = ensignTint(namespaceColor(this.pod.ns));
    this.status = unitState(this.pod);
    this.setAlpha(1);
    this.ship.setAlpha(1).setTint(color).setTexture(ATLAS.ships.key, SPRITES.ship(0, hashString(this.key) % 4).frame).setScale(SHIP_SCALE);
    this.marks.clear();
    this.fire.setVisible(false).stop();
    switch (this.status) {
      case 'pending':
        this.ship.setTexture(ATLAS.ships.key, SPRITES.hullSmall(0).frame).setScale(SHIP_SCALE * 1.1).setTint(color);
        break;
      case 'ok':
        break;
      case 'notready':
        this.marks.lineStyle(2, 0xe8b33a, 1).strokeCircle(TILE / 2, TILE / 2, TILE / 2);
        break;
      case 'crash':
        this.fire.setVisible(true).play(ANIM.fire);
        break;
      case 'terminating':
        this.setAlpha(0.45);
        break;
      case 'done':
        this.ship.setTint(0x777777);
        break;
    }
    if (this.obsolete) {
      this.ship.setTint(Phaser.Display.Color.ValueToColor(color).desaturate(60).darken(20).color);
      this.marks.lineStyle(1, 0xe8b33a, 0.9).strokeCircle(TILE / 2, TILE / 2, TILE / 2 - 1);
    }
  }
}
