import Phaser from 'phaser';
import { selection, settings, store } from './app';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { HudScene } from './scenes/HudScene';
import { MapScene } from './scenes/MapScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#000000',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MapScene, HudScene],
});

/** Devtools handle: `harbor.store.pods`, `harbor.game.scene.keys.Map`, ... */
declare global {
  interface Window {
    harbor: { game: Phaser.Game; store: typeof store; selection: typeof selection; settings: typeof settings };
  }
}
window.harbor = { game, store, selection, settings };
