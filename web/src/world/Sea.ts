import Phaser from 'phaser';
import { MAP_FONT, SEA } from '../config';
import { ATLAS, TILES } from '../gfx/manifest';
import { hashString } from '../layout/hash';
import { GATE_W, SEA_PAD, TILE, TILE_SCALE, TILE_SRC, type MapLayout } from '../layout/grid';

/**
 * Open water for the whole world, a breakwater of rocks along the edge, and
 * the "open sea" strip for whatever could not be berthed. Rebuilt when the
 * world size changes; scrolls its wave layer every frame.
 */
export class Sea {
  private water?: Phaser.GameObjects.TileSprite;
  private waves?: Phaser.GameObjects.TileSprite;
  private readonly rocks: Phaser.GameObjects.Image[] = [];
  private voidLabel?: Phaser.GameObjects.Text;
  private size = { w: 0, h: 0 };
  private gateKey = '';

  constructor(private readonly scene: Phaser.Scene) {}

  rebuild(L: MapLayout): void {
    const w = L.width * TILE;
    const h = L.height * TILE;
    const gateKey = [...L.gates.values()].map((g) => g.x).sort((a, b) => a - b).join(',');
    if (w !== this.size.w || h !== this.size.h || gateKey !== this.gateKey) {
      this.size = { w, h };
      this.gateKey = gateKey;
      this.water?.destroy();
      this.waves?.destroy();
      // The pack's water is pale; tint it to sea blue and float the wave tile over it.
      const pad = SEA_PAD * TILE;
      this.water = this.scene.add.tileSprite(-pad, -pad, w + 2 * pad, h + 2 * pad, ATLAS.tiles.key, TILES.water).setOrigin(0).setTileScale(TILE_SCALE).setDepth(-20).setTint(SEA.water);
      this.waves = this.scene.add.tileSprite(-pad, -pad, w + 2 * pad, h + 2 * pad, ATLAS.tiles.key, TILES.waterWave).setOrigin(0).setTileScale(TILE_SCALE).setDepth(-19).setAlpha(0.35).setTint(SEA.foam);
      for (const r of this.rocks) r.destroy();
      this.rocks.length = 0;
      // Breakwater: a rock every other tile along the edge, variant by position.
      const rockFrames = [TILES.rock, 48, 50, 64, 65, 66];
      const put = (tx: number, ty: number): void => {
        const f = rockFrames[hashString(`${tx},${ty}`) % rockFrames.length]!;
        this.rocks.push(this.scene.add.image(tx * TILE + TILE / 2, ty * TILE + TILE / 2, ATLAS.tiles.key, f).setScale(TILE_SCALE).setDepth(-15));
      };
      const inGate = (tx: number): boolean => [...L.gates.values()].some((g) => tx >= g.x && tx < g.x + GATE_W);
      for (let x = 0; x < L.width; x += 2) {
        put(x, 0);
        if (!inGate(x + 1)) put(x + 1, L.height - 1); // the mouth stays open at the gates
      }
      for (let y = 2; y < L.height - 1; y += 2) {
        put(0, y);
        put(L.width - 1, y + 1 < L.height - 1 ? y + 1 : y);
      }
    }
    this.voidLabel?.destroy();
    this.voidLabel = this.scene.add.text(TILE, L.voidY * TILE - 14, 'OPEN SEA · unberthed', {
      fontFamily: MAP_FONT, fontSize: '11px', fontStyle: '800', color: '#ffffff', stroke: '#1d5f87', strokeThickness: 3,
    }).setDepth(-14).setAlpha(0.9);
  }

  update(delta: number): void {
    if (this.waves) {
      this.waves.tilePositionX += delta * 0.006 * TILE_SRC;
      this.waves.tilePositionY += delta * 0.002 * TILE_SRC;
    }
  }
}
