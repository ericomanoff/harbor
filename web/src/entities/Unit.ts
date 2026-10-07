import Phaser from 'phaser';
import { PALETTE } from '../config';
import { namespaceColor } from '../layout/colors';
import { TILE, type Placement } from '../layout/grid';
import type { Pod } from '../store/cluster';

const SIZE = 16;
const PAD = (TILE - SIZE) / 2;

export type UnitState = 'pending' | 'ok' | 'notready' | 'crash' | 'terminating' | 'done';

export function unitState(pod: Pod): UnitState {
  if (pod.phase === 'Terminating') return 'terminating';
  if (pod.phase === 'Succeeded' || pod.phase === 'Failed') return 'done';
  const r = pod.reason ?? '';
  if (/BackOff|Err|OOM|Evicted/i.test(r)) return 'crash';
  if (pod.phase === 'Pending' || !pod.node) return 'pending';
  return pod.ready ? 'ok' : 'notready';
}

/** A Pod: a unit parked on its node's plateau. */
export class UnitView extends Phaser.GameObjects.Container {
  readonly key: string;
  pod: Pod;
  placement: Placement;
  dying = false;

  private readonly shape: Phaser.GameObjects.Graphics;
  private readonly fire: Phaser.GameObjects.Graphics;
  private readonly sel: Phaser.GameObjects.Graphics;
  private status: UnitState = 'ok';

  constructor(scene: Phaser.Scene, key: string, pod: Pod, placement: Placement, spawnFrom?: { x: number; y: number }) {
    super(scene, placement.x * TILE, placement.y * TILE);
    this.key = key;
    this.pod = pod;
    this.placement = placement;
    this.shape = scene.add.graphics();
    this.fire = scene.add.graphics();
    this.sel = scene.add.graphics();
    this.add([this.shape, this.fire, this.sel]);
    this.setDepth(20);
    scene.add.existing(this);
    this.redraw();
    if (spawnFrom) {
      this.setPosition(spawnFrom.x, spawnFrom.y);
      this.driveTo(placement);
    }
  }

  rect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(this.x, this.y, TILE, TILE);
  }

  update(pod: Pod, placement: Placement): void {
    this.pod = pod;
    const moved = placement.x !== this.placement.x || placement.y !== this.placement.y;
    this.placement = placement;
    if (moved) this.driveTo(placement);
    this.redraw();
  }

  private driveTo(p: Placement): void {
    const dist = Phaser.Math.Distance.Between(this.x, this.y, p.x * TILE, p.y * TILE);
    this.scene.tweens.add({
      targets: this,
      x: p.x * TILE,
      y: p.y * TILE,
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

  /** Per-frame blink for pending and crashing units. */
  tick(time: number): void {
    const phase = Math.floor(time / 250) % 2 === 0;
    if (this.status === 'crash') {
      this.fire.setVisible(phase);
    } else if (this.status === 'pending') {
      this.shape.setAlpha(phase ? 1 : 0.45);
    }
  }

  /** Death animation, then destroy. */
  die(): void {
    if (this.dying) return;
    this.dying = true;
    this.shape.clear();
    this.shape.fillStyle(PALETTE.alert, 1);
    this.shape.fillRect(PAD, PAD, SIZE, SIZE);
    this.scene.tweens.add({
      targets: this,
      scaleX: 0.1,
      scaleY: 0.1,
      alpha: 0,
      x: this.x + TILE / 2,
      y: this.y + TILE / 2,
      duration: 450,
      ease: 'Quad.easeIn',
      onComplete: () => this.destroy(),
    });
  }

  private redraw(): void {
    const color = namespaceColor(this.pod.ns);
    this.status = unitState(this.pod);
    this.shape.clear();
    this.shape.setAlpha(1);
    this.setAlpha(1);
    this.fire.clear();
    this.fire.setVisible(false);
    switch (this.status) {
      case 'pending':
        this.shape.lineStyle(2, color, 1);
        this.shape.strokeRect(PAD + 1, PAD + 1, SIZE - 2, SIZE - 2);
        break;
      case 'ok':
        this.shape.fillStyle(color, 1);
        this.shape.fillRect(PAD, PAD, SIZE, SIZE);
        this.shape.fillStyle(0x000000, 0.35);
        this.shape.fillRect(PAD + 4, PAD + 4, SIZE - 8, SIZE - 8);
        break;
      case 'notready':
        this.shape.fillStyle(color, 0.5);
        this.shape.fillRect(PAD, PAD, SIZE, SIZE);
        this.shape.lineStyle(2, PALETTE.amber, 1);
        this.shape.strokeRect(PAD + 1, PAD + 1, SIZE - 2, SIZE - 2);
        break;
      case 'crash':
        this.shape.fillStyle(color, 0.6);
        this.shape.fillRect(PAD, PAD, SIZE, SIZE);
        this.shape.lineStyle(2, PALETTE.alert, 1);
        this.shape.strokeRect(PAD + 1, PAD + 1, SIZE - 2, SIZE - 2);
        this.fire.fillStyle(PALETTE.alert, 1);
        this.fire.fillTriangle(TILE / 2, 0, TILE / 2 - 5, 9, TILE / 2 + 5, 9);
        this.fire.fillStyle(PALETTE.amber, 1);
        this.fire.fillTriangle(TILE / 2, 3, TILE / 2 - 2, 9, TILE / 2 + 2, 9);
        break;
      case 'terminating':
        this.shape.fillStyle(color, 1);
        this.shape.fillRect(PAD, PAD, SIZE, SIZE);
        this.setAlpha(0.4);
        break;
      case 'done':
        this.shape.fillStyle(0x555555, 1);
        this.shape.fillRect(PAD, PAD, SIZE, SIZE);
        break;
    }
  }
}
