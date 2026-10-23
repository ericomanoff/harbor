import Phaser from 'phaser';
import { SEA } from '../config';
import { unitState, type UnitState } from '../game/unitState';
import { ANIM } from '../gfx/anims';
import { ATLAS, SPRITES, TILES } from '../gfx/manifest';
import { smokeEmitter, wakeEmitter } from '../world/fx';
import { hashString } from '../layout/hash';
import { namespaceColor } from '../layout/colors';
import { TILE, TILE_SCALE, type Placement } from '../layout/grid';
import type { Pod } from '../store/cluster';

const SHIP_SCALE = 0.42; // 66x113 frame → ~28x47 px; overhangs its tile, which reads better than a speck

export type ShipVariant = 'ship' | 'tanker' | 'tug' | 'boat';

/** Which hull a pod sails: by the controller that owns it. */
export function shipVariant(pod: Pod): ShipVariant {
  switch (pod.ownerKind) {
    case 'StatefulSet': return 'tanker';
    case 'DaemonSet': return 'tug';
    case 'Job': return 'boat';
    default: return 'ship';
  }
}

/** Hull number for a tanker: the StatefulSet ordinal at the end of its name. */
export function hullNumber(pod: Pod): string {
  const m = /-(\d+)$/.exec(pod.name);
  return m ? m[1]! : '';
}

// The fleet flag every ship flies: a short pole at the stern quarter with the
// fleet's flag flying right, the same drawing as the shipyard's at ship scale.
const FLAG_X = TILE - 9;
const FLAG_Y = -6;
const FLAG_W = 11;
const FLAG_H = 8;
const POLE_H = 20;

/** Pastel fleet tint: tint multiplies, so mix toward white to keep hulls readable. */
function fleetTint(color: number): number {
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
  /** Hull plus deck cargo; rotates as one. */
  private readonly hull: Phaser.GameObjects.Container;
  private readonly ship: Phaser.GameObjects.Image;
  private readonly crates: Phaser.GameObjects.Image[];
  private readonly number: Phaser.GameObjects.Text;
  /** The fleet flag: upright whatever way the hull points. */
  private readonly flag: Phaser.GameObjects.Graphics;
  private readonly initial: Phaser.GameObjects.Text;
  private variant: ShipVariant = 'ship';
  private wake?: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke?: Phaser.GameObjects.Particles.ParticleEmitter;
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
    this.ship = scene.add.image(0, 0, ATLAS.ships.key, SPRITES.ship(0, hashString(key) % 4).frame).setScale(SHIP_SCALE);
    // Cargo: one crate per container (up to three) stacked along the deck.
    this.crates = [0, 1, 2].map((i) => scene.add.image(0, -4 + i * 6, ATLAS.tiles.key, TILES.crate).setScale(TILE_SCALE * 0.28).setVisible(false));
    this.number = scene.add.text(0, 0, '', { fontFamily: 'Nunito, sans-serif', fontSize: '9px', fontStyle: '900', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setOrigin(0.5).setVisible(false);
    this.hull = scene.add.container(TILE / 2, TILE / 2, [this.ship, ...this.crates, this.number]);
    this.flag = scene.add.graphics();
    this.initial = scene.add.text(0, 0, '', { fontFamily: 'Nunito, sans-serif', fontSize: '7px', fontStyle: '900', color: '#ffffff', stroke: '#1d2a12', strokeThickness: 1 }).setOrigin(0.5);
    this.fire = scene.add.sprite(TILE / 2, TILE / 2 - 2, ATLAS.ships.key, SPRITES.fire[0].frame).setScale(0.45).setOrigin(0.5, 1).setVisible(false);
    this.marks = scene.add.graphics();
    this.sel = scene.add.graphics();
    this.hit = scene.add.graphics();
    this.hit.fillStyle(0xe5473a, 0.5).fillCircle(TILE / 2, TILE / 2, TILE / 2).setVisible(false);
    this.add([this.shadow, this.hull, this.flag, this.initial, this.marks, this.fire, this.sel, this.hit]);
    this.setDepth(20);
    scene.add.existing(this);
    this.hull.setRotation(((hashString(key) >> 4) % 8) * (Math.PI / 4));
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
    if (dist > 0) this.hull.setRotation(Math.atan2(ty - this.y, tx - this.x) + Math.PI / 2);
    this.wake ??= wakeEmitter(this.scene, this, { x: TILE / 2, y: TILE / 2 });
    this.wake.start();
    this.scene.tweens.add({
      targets: this, x: tx, y: ty, duration: Phaser.Math.Clamp(dist * 2, 300, 2200), ease: 'Sine.easeInOut',
      onComplete: () => this.wake?.stop(),
    });
  }

  setSelected(on: boolean): void {
    this.sel.clear();
    if (on) this.sel.lineStyle(2, SEA.outline, 1).strokeCircle(TILE / 2, TILE / 2, TILE / 2 + 2);
  }

  /** Bob at anchor, blink while pending, flash on warnings. */
  tick(time: number): void {
    const bob = Math.sin(time / 700 + this.bobPhase * Math.PI * 2);
    this.hull.y = TILE / 2 + bob * 1.2;
    this.drawFlag(bob * 1.2, Math.sin(time / 250 + this.bobPhase * Math.PI * 2) * 1.5);
    this.hit.setVisible(time < this.flashUntil && Math.floor(time / 120) % 2 === 0);
    if (this.status === 'pending') this.ship.setAlpha(Math.floor(time / 300) % 2 === 0 ? 0.9 : 0.45);
  }

  /** Sinks: explosion, then the hull fades under the waves leaving debris. */
  die(): void {
    if (this.dying) return;
    this.dying = true;
    this.fire.setVisible(false);
    this.wake?.stop();
    this.smoke?.stop();
    this.scene.time.delayedCall(2000, () => { this.wake?.destroy(); this.smoke?.destroy(); });
    const boom = this.scene.add.sprite(this.x + TILE / 2, this.y + TILE / 2, ATLAS.ships.key, SPRITES.explosion[0].frame).setScale(0.6).setDepth(30);
    boom.play(ANIM.explosion);
    boom.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => boom.destroy());
    const debris = this.scene.add.image(this.x + TILE / 2, this.y + TILE / 2, ATLAS.ships.key, SPRITES.wood(hashString(this.key) % 4).frame).setScale(0.4).setDepth(19).setAlpha(0.9);
    this.scene.tweens.add({ targets: debris, alpha: 0, duration: 4000, delay: 1500, onComplete: () => debris.destroy() });
    this.scene.tweens.add({ targets: this.hull, scaleX: 0.05, scaleY: 0.05, alpha: 0, duration: 700, delay: 150 });
    this.scene.tweens.add({ targets: this, alpha: 0, duration: 800, delay: 200, onComplete: () => { this.wake?.destroy(); this.smoke?.destroy(); this.destroy(); } });
  }

  /** The fleet flag, matching the shipyard's: a pole, a waving flag in the fleet's colour, the fleet's initial on it. */
  private drawFlag(bob: number, wave: number): void {
    const g = this.flag;
    const y = FLAG_Y + bob;
    g.clear();
    g.fillStyle(0x4a3826, 1).fillRect(FLAG_X, y, 2, POLE_H);
    g.fillStyle(0xffffff, 1).fillCircle(FLAG_X + 1, y, 1.5);
    const x0 = FLAG_X + 2;
    g.fillStyle(namespaceColor(this.pod.ns), 1);
    g.beginPath();
    g.moveTo(x0, y + 1);
    g.lineTo(x0 + FLAG_W, y + 1 + wave);
    g.lineTo(x0 + FLAG_W, y + 1 + FLAG_H + wave);
    g.lineTo(x0, y + 1 + FLAG_H);
    g.closePath();
    g.fillPath();
    g.lineStyle(1, 0xffffff, 0.95);
    g.strokePath();
    this.initial.setPosition(x0 + FLAG_W / 2, y + 1 + FLAG_H / 2 + wave / 2);
  }

  private redraw(): void {
    const color = fleetTint(namespaceColor(this.pod.ns));
    this.status = unitState(this.pod);
    this.variant = shipVariant(this.pod);
    this.setAlpha(1);
    this.ship.setAlpha(1).setTint(color);
    this.number.setVisible(false);
    this.initial.setText((this.pod.ns[0] ?? '').toUpperCase());
    this.drawFlag(0, 0);
    switch (this.variant) {
      case 'tanker': // long hull, no sails, hull number on deck
        this.ship.setTexture(ATLAS.ships.key, SPRITES.hullLarge(1).frame).setScale(SHIP_SCALE * 1.15);
        this.number.setText(hullNumber(this.pod)).setVisible(true);
        break;
      case 'tug': // small, stubby, never from a shipyard
        this.ship.setTexture(ATLAS.ships.key, SPRITES.dinghy(hashString(this.key) % 3).frame).setScale(SHIP_SCALE * 0.9);
        break;
      case 'boat': // fishing boat: a small hull with a short sail
        this.ship.setTexture(ATLAS.ships.key, SPRITES.ship(0, 3).frame).setScale(SHIP_SCALE * 0.8);
        break;
      default:
        this.ship.setTexture(ATLAS.ships.key, SPRITES.ship(0, hashString(this.key) % 4).frame).setScale(SHIP_SCALE);
    }
    this.marks.clear();
    this.fire.setVisible(false).stop();
    this.smoke?.stop();
    const cargo = Math.min(3, this.pod.containers.length);
    this.crates.forEach((c, i) => c.setVisible(i < cargo && this.status !== 'pending'));
    switch (this.status) {
      case 'pending':
        this.ship.setTexture(ATLAS.ships.key, SPRITES.hullSmall(0).frame).setScale(SHIP_SCALE * 1.1).setTint(color);
        this.number.setVisible(false);
        break;
      case 'ok':
        break;
      case 'notready':
        this.marks.lineStyle(2, 0xe8b33a, 1).strokeCircle(TILE / 2, TILE / 2, TILE / 2);
        break;
      case 'crash':
        this.fire.setVisible(true).play(ANIM.fire);
        this.smoke ??= smokeEmitter(this.scene, this, { x: TILE / 2, y: TILE / 2 - 8 });
        this.smoke.start();
        break;
      case 'terminating':
        this.setAlpha(0.45);
        break;
      case 'done': // a fishing boat home with its catch, or a wreck
        this.ship.setTint(this.variant === 'boat' && this.pod.phase === 'Succeeded' ? 0xb8b8b8 : 0x777777);
        break;
    }
    if (this.obsolete) {
      this.ship.setTint(Phaser.Display.Color.ValueToColor(color).desaturate(60).darken(20).color);
      this.marks.lineStyle(1, 0xe8b33a, 0.9).strokeCircle(TILE / 2, TILE / 2, TILE / 2 - 1);
    }
  }
}
