import Phaser from 'phaser';
import { contexts, getHealth } from '../api/client';
import { source, store } from '../app';
import { splash } from '../boot/splash';
import { startDemo } from '../demo/demo';
import { createPackAnims, loadPackAssets } from '../gfx/anims';
import { connectWebSocket } from '../store/source';
import { createFxTextures } from '../world/fx';

const HAIL_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}

/**
 * First scene. Draws nothing: the HTML splash is the loading screen. Loads
 * the atlases, waits for the font, hails the backend, picks the data source
 * and starts the map (or the style page).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    splash().setStage('assets');
    this.load.on('progress', (v: number) => splash().setProgress(v * 0.7));
    loadPackAssets(this);
  }

  create(): void {
    createPackAnims(this);
    createFxTextures(this);
    void this.run();
  }

  private async run(): Promise<void> {
    const params = new URLSearchParams(location.search);
    if (params.has('style')) {
      this.scene.start('Style');
      void splash().done();
      return;
    }
    const demo = params.has('demo');
    const s = splash();

    s.setStage('fonts');
    await Promise.race([document.fonts?.load('800 12px Nunito') ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);

    if (!demo) {
      s.setStage('backend');
      try {
        const health = await withTimeout(getHealth(), HAIL_TIMEOUT_MS);
        s.setVersion(health.version);
        const cl = await withTimeout(contexts.list(), HAIL_TIMEOUT_MS);
        s.setStage('backend', cl.current || undefined);
      } catch {
        s.fail('No harbor in sight. Is the harbor binary running?', {
          onRetry: () => location.reload(),
          onDemo: () => {
            location.search = '?demo';
          },
        });
        return;
      }
    }

    s.setStage('sail');
    source.stop = demo ? startDemo(store) : connectWebSocket(store);
    this.scene.start('Map');
  }
}
