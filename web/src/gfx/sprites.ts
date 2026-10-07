import Phaser from 'phaser';

/**
 * All art is generated at boot from pixel maps and small Graphics routines,
 * so the game has no external assets and nothing from any real game. Units
 * and factory accents are drawn in white and greys so a tint gives them the
 * faction colour in shades, the way C&C remaps house colours.
 */

export const TEX = {
  tank: 'tank',
  factoryBase: 'factory-base',
  factoryAccent: 'factory-accent',
  scaffold: 'scaffold',
  fire: 'fire',
  boom: 'boom',
} as const;

export const ANIM = { fire: 'fire', boom: 'boom' } as const;

const PIX: Record<string, number> = { w: 0xffffff, l: 0xb0b0b0, d: 0x707070, k: 0x101010 };

/** 16x16 tank, facing up. '.' is transparent. */
const TANK = [
  '................',
  '......kkkk......',
  '......kwwk......',
  '......kwwk......',
  '..kkkkkwwkkkkk..',
  '.kddddkwwkddddk.',
  '.kdlllkwwkllldk.',
  '.kdllkkwwkklldk.',
  '.kdllkwwwwkllkk.',
  '.kdllkkwwkkllkk.',
  '.kdlllkkkklllddk',
  '.kddddddddddddk.',
  '.kkkkkkkkkkkkkk.',
  '.kk.kk.kk.kk.kk.',
  '.kkkkkkkkkkkkkk.',
  '................',
];

function pixelTexture(scene: Phaser.Scene, key: string, rows: string[]): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const c = PIX[ch];
      if (c === undefined) return;
      g.fillStyle(c, 1).fillRect(x, y, 1, 1);
    });
  });
  g.generateTexture(key, rows[0]!.length, rows.length);
  g.destroy();
}

function factoryTextures(scene: Phaser.Scene): void {
  const S = 64;
  if (!scene.textures.exists(TEX.factoryBase)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x23231c, 1).fillRect(0, 0, S, S); // slab
    g.fillStyle(0x3a3a30, 1).fillRect(3, 3, S - 6, S - 6); // walls
    g.fillStyle(0x4a4a3c, 1).fillRect(3, 3, S - 6, 18); // roof band
    g.fillStyle(0x2a2a22, 1);
    for (let i = 0; i < 4; i++) g.fillRect(10 + i * 13, 6, 7, 10); // vents
    g.fillStyle(0x1a1a14, 1).fillRect(S / 2 - 10, S - 19, 20, 16); // door
    g.fillStyle(0x000000, 1).fillRect(S / 2 - 8, S - 17, 16, 14);
    g.fillStyle(0x5a5a4a, 1).fillRect(S - 14, 24, 6, 20); // chimney
    g.fillStyle(0x6a6a5a, 1).fillRect(S - 15, 22, 8, 3);
    g.lineStyle(1, 0x000000, 0.6).strokeRect(3.5, 3.5, S - 7, S - 7);
    g.generateTexture(TEX.factoryBase, S, S);
    g.destroy();
  }
  if (!scene.textures.exists(TEX.factoryAccent)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillRect(3, 21, S - 6, 3); // roof edge stripe
    g.fillRect(S / 2 - 12, S - 21, 24, 2); // door lintel
    g.fillRect(S / 2 - 12, S - 21, 2, 18).fillRect(S / 2 + 10, S - 21, 2, 18); // door posts
    g.fillStyle(0xd0d0d0, 1).fillRect(6, 28, 12, 8).fillRect(6, 40, 12, 8); // signal panels
    g.generateTexture(TEX.factoryAccent, S, S);
    g.destroy();
  }
  if (!scene.textures.exists(TEX.scaffold)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.lineStyle(2, 0xffb000, 1);
    for (let i = 0; i < S; i += 8) {
      g.lineBetween(i, 0, 0, i);
      g.lineBetween(S, i, i, S);
    }
    g.strokeRect(1, 1, S - 2, S - 2);
    g.generateTexture(TEX.scaffold, S, S);
    g.destroy();
  }
}

function effectTextures(scene: Phaser.Scene): void {
  for (let f = 0; f < 3; f++) {
    const key = `${TEX.fire}-${f}`;
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const h = 10 + f * 2;
    g.fillStyle(0xff2a2a, 1).fillTriangle(6, 12 - h, 1, 12, 11, 12);
    g.fillStyle(0xffb000, 1).fillTriangle(6, 14 - h, 3, 12, 9, 12);
    g.fillStyle(0xffff80, 1).fillTriangle(6, 16 - h, 5, 12, 7, 12);
    g.generateTexture(key, 12, 14);
    g.destroy();
  }
  for (let f = 0; f < 4; f++) {
    const key = `${TEX.boom}-${f}`;
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const r = 4 + f * 4;
    g.fillStyle(f < 3 ? 0xff2a2a : 0x444444, f < 3 ? 1 : 0.7).fillCircle(16, 16, r);
    if (f < 3) {
      g.fillStyle(0xffb000, 1).fillCircle(16, 16, r * 0.6);
      g.fillStyle(0xffff80, 1).fillCircle(16, 16, r * 0.3);
    }
    g.generateTexture(key, 32, 32);
    g.destroy();
  }
}

/** Builds every texture and animation once; safe to call again. */
export function buildTextures(scene: Phaser.Scene): void {
  pixelTexture(scene, TEX.tank, TANK);
  factoryTextures(scene);
  effectTextures(scene);
  if (!scene.anims.exists(ANIM.fire)) {
    scene.anims.create({ key: ANIM.fire, frames: [0, 1, 2].map((f) => ({ key: `${TEX.fire}-${f}` })), frameRate: 9, repeat: -1 });
  }
  if (!scene.anims.exists(ANIM.boom)) {
    scene.anims.create({ key: ANIM.boom, frames: [0, 1, 2, 3].map((f) => ({ key: `${TEX.boom}-${f}` })), frameRate: 14, repeat: 0 });
  }
}

/** Snaps a direction to the nearest of 8 facings and returns it in radians. */
export function snapFacing(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
}
