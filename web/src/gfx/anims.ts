import Phaser from 'phaser';
import { ATLAS, SPRITES } from './manifest';

export const ANIM = { fire: 'fire', explosion: 'explosion' } as const;

/** Loads the pack atlases; call from a scene's preload. */
export function loadPackAssets(scene: Phaser.Scene): void {
  scene.load.atlasXML(ATLAS.ships.key, ATLAS.ships.png, ATLAS.ships.xml);
  scene.load.spritesheet(ATLAS.tiles.key, ATLAS.tiles.png, { frameWidth: ATLAS.tiles.size, frameHeight: ATLAS.tiles.size });
}

/** Registers animations once; safe to call again. */
export function createPackAnims(scene: Phaser.Scene): void {
  if (!scene.anims.exists(ANIM.fire)) {
    scene.anims.create({ key: ANIM.fire, frames: SPRITES.fire.map((r) => ({ key: r.atlas, frame: r.frame })), frameRate: 6, repeat: -1 });
  }
  if (!scene.anims.exists(ANIM.explosion)) {
    scene.anims.create({ key: ANIM.explosion, frames: SPRITES.explosion.map((r) => ({ key: r.atlas, frame: r.frame })), frameRate: 10, repeat: 0 });
  }
}
