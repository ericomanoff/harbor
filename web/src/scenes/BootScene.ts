import Phaser from 'phaser';
import { store } from '../app';
import { GAME_HEIGHT, GAME_WIDTH, PALETTE } from '../config';
import { startDemo } from '../demo/demo';
import { connectWebSocket } from '../store/source';

/**
 * First scene: picks the data source (live WebSocket, or the demo cluster
 * when the URL has ?demo), shows the boot banner briefly, then starts the
 * map. Later it will also load atlases and audio.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const g = this.add.graphics();
    g.fillStyle(PALETTE.radarGround, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.lineStyle(2, PALETTE.bevelLight, 1).strokeRect(8, 8, GAME_WIDTH - 16, GAME_HEIGHT - 16);

    const mono = { fontFamily: 'monospace', fontSize: '28px', color: '#39ff14' };
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, 'HARBOR', mono).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'ESTABLISHING BATTLEFIELD CONTROL...', { ...mono, fontSize: '14px' }).setOrigin(0.5);

    const demo = new URLSearchParams(location.search).has('demo');
    if (demo) startDemo(store);
    else connectWebSocket(store);

    this.time.delayedCall(700, () => this.scene.start('Map'));
  }
}
