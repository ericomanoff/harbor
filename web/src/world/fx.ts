import Phaser from 'phaser';
import { MAP_FONT } from '../config';

export const FX = { dot: 'fx-dot', puff: 'fx-puff' } as const;

/** Tiny generated textures for particles; called once at boot. */
export function createFxTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(FX.dot)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture(FX.dot, 8, 8);
    g.destroy();
  }
  if (!scene.textures.exists(FX.puff)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 0.35).fillCircle(8, 8, 8);
    g.fillStyle(0xffffff, 0.6).fillCircle(8, 8, 5);
    g.generateTexture(FX.puff, 16, 16);
    g.destroy();
  }
}

/** Foam wake behind a moving object. Start/stop it around a tween. */
export function wakeEmitter(scene: Phaser.Scene, follow: Phaser.GameObjects.Components.Transform, offset: { x: number; y: number }): Phaser.GameObjects.Particles.ParticleEmitter {
  const e = scene.add.particles(0, 0, FX.dot, {
    follow,
    followOffset: offset,
    lifespan: 700,
    speed: { min: 4, max: 12 },
    angle: { min: 0, max: 360 },
    scale: { start: 0.7, end: 0 },
    alpha: { start: 0.8, end: 0 },
    frequency: 45,
    quantity: 1,
    emitting: false,
  });
  e.setDepth(19);
  return e;
}

/** Smoke rising from a burning ship. */
export function smokeEmitter(scene: Phaser.Scene, follow: Phaser.GameObjects.Components.Transform, offset: { x: number; y: number }): Phaser.GameObjects.Particles.ParticleEmitter {
  const e = scene.add.particles(0, 0, FX.puff, {
    follow,
    followOffset: offset,
    lifespan: 1400,
    speedY: { min: -22, max: -12 },
    speedX: { min: -4, max: 4 },
    scale: { start: 0.35, end: 1.1 },
    alpha: { start: 0.55, end: 0 },
    tint: 0x333333,
    frequency: 260,
    quantity: 1,
    emitting: false,
  });
  e.setDepth(31);
  return e;
}

/** An expanding ring of foam, for a launch. */
export function splash(scene: Phaser.Scene, x: number, y: number): void {
  const ring = scene.add.circle(x, y, 4).setStrokeStyle(3, 0xffffff, 0.9).setDepth(19);
  scene.tweens.add({ targets: ring, radius: 26, alpha: 0, duration: 650, ease: 'Quad.easeOut', onUpdate: () => ring.setRadius(ring.radius), onComplete: () => ring.destroy() });
  scene.add.particles(x, y, FX.dot, {
    lifespan: 500, speed: { min: 20, max: 50 }, angle: { min: 0, max: 360 }, scale: { start: 0.6, end: 0 }, alpha: { start: 0.9, end: 0 },
    quantity: 10, emitting: false,
  }).setDepth(19).explode(10, x, y);
}

/** A rising, fading pill of text, like a "collected" popup. */
export function floatText(scene: Phaser.Scene, x: number, y: number, text: string, color = '#ffffff'): void {
  const t = scene.add.text(x, y, text, { fontFamily: MAP_FONT, fontSize: '12px', fontStyle: '900', color, stroke: '#1d2a12', strokeThickness: 4 }).setOrigin(0.5).setDepth(40);
  scene.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 1400, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
}
