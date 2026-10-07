import Phaser from 'phaser';
import { formatHealth, getHealth } from '../api/client';
import { GAME_HEIGHT, GAME_WIDTH, PALETTE } from '../config';

/**
 * First scene. In Phase 0 it only proves the pipeline: Phaser renders, the
 * Go backend answers, and the palette is wired. Later it loads atlases and
 * audio, then hands off to MissionSelectScene.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const g = this.add.graphics();
    g.fillStyle(PALETTE.radarGround, 1);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.lineStyle(2, PALETTE.bevelLight, 1);
    g.strokeRect(8, 8, GAME_WIDTH - 16, GAME_HEIGHT - 16);

    const mono = { fontFamily: 'monospace', fontSize: '28px', color: '#39ff14' };
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, 'HARBOR', mono).setOrigin(0.5);
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'ESTABLISHING BATTLEFIELD CONTROL...', {
        ...mono,
        fontSize: '14px',
      })
      .setOrigin(0.5);

    const status = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'CONTACTING BACKEND', {
        ...mono,
        fontSize: '14px',
        color: '#ffb000',
      })
      .setOrigin(0.5);

    getHealth()
      .then((h) => status.setText(formatHealth(h)).setColor('#39ff14'))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        status.setText(`BACKEND OFFLINE: ${msg}`).setColor('#ff2a2a');
      });
  }
}
