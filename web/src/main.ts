import Phaser from 'phaser';
import { mode, selection, settings, store } from './app';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { MapScene } from './scenes/MapScene';
import { StyleScene } from './scenes/StyleScene';
import './hud/hud.css';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#000000',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  scene: [BootScene, MapScene, StyleScene],
});

/** Devtools handle: `harbor.store.pods`, `harbor.game.scene.keys.Map`, ... */
declare global {
  interface Window {
    harbor: { game: Phaser.Game; store: typeof store; selection: typeof selection; settings: typeof settings; mode: typeof mode };
  }
}
window.harbor = { game, store, selection, settings, mode };
