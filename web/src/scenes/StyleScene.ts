import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { ATLAS, TILES, allSpriteFrames } from '../gfx/manifest';
import { FACTION_PALETTE, hexString } from '../layout/colors';

/**
 * ?style — the V0 review page. Left: every manifest frame and every tile,
 * labelled, over water. Right (DOM): design tokens and HUD components.
 * Nothing here is used by the game itself.
 */
export class StyleScene extends Phaser.Scene {
  constructor() {
    super('Style');
  }

  preload(): void {
    this.load.atlasXML(ATLAS.ships.key, ATLAS.ships.png, ATLAS.ships.xml);
    this.load.spritesheet(ATLAS.tiles.key, ATLAS.tiles.png, { frameWidth: ATLAS.tiles.size, frameHeight: ATLAS.tiles.size });
  }

  create(): void {
    const cam = this.cameras.main;
    cam.setBackgroundColor(0x5fbde6);
    // Water background from the tilesheet, half scale.
    for (let y = 0; y < GAME_HEIGHT + 32; y += 32) {
      for (let x = 0; x < GAME_WIDTH + 32; x += 32) this.add.image(x, y, ATLAS.tiles.key, TILES.water).setScale(0.5).setOrigin(0);
    }

    const label = (x: number, y: number, text: string): void => {
      this.add.text(x, y, text, { fontFamily: 'Nunito, sans-serif', fontSize: '9px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setOrigin(0.5, 0);
    };

    // All manifest frames, scaled to fit 48 px cells.
    this.add.text(8, 6, 'SPRITES (manifest)', { fontFamily: 'Nunito, sans-serif', fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 });
    const frames = allSpriteFrames();
    const cols = 12;
    frames.forEach(({ name, ref }, i) => {
      const x = 32 + (i % cols) * 56;
      const y = 44 + Math.floor(i / cols) * 62;
      const img = this.add.image(x, y, ref.atlas, ref.frame);
      const s = Math.min(1, 44 / Math.max(img.width, img.height));
      img.setScale(s);
      label(x, y + 24, name);
    });

    // The whole tilesheet with indices, so TILES can be named by eye.
    const ty = 44 + Math.ceil(frames.length / cols) * 62 + 8;
    this.add.text(8, ty - 16, 'TILES (index)', { fontFamily: 'Nunito, sans-serif', fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 });
    for (let i = 0; i < ATLAS.tiles.count; i++) {
      const x = 8 + (i % ATLAS.tiles.columns) * 42;
      const y = ty + Math.floor(i / ATLAS.tiles.columns) * 46;
      this.add.image(x, y, ATLAS.tiles.key, i).setScale(40 / ATLAS.tiles.size).setOrigin(0);
      label(x + 20, y + 30, String(i));
    }

    // Faction palette ⇄ ship colour families, side by side.
    const py = ty + 6 * 46 + 8;
    this.add.text(8, py - 16, 'ENSIGNS: faction palette vs pack hull colours', { fontFamily: 'Nunito, sans-serif', fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 });
    FACTION_PALETTE.forEach((c, i) => {
      const x = 30 + i * 70;
      this.add.rectangle(x, py + 12, 24, 24, c).setStrokeStyle(2, 0x000000, 0.4);
      const ship = this.add.image(x + 30, py + 14, ATLAS.ships.key, `ship (${(i % 6) * 4 + 1}).png`).setScale(0.35);
      label(x + 12, py + 36, hexString(c));
      ship.setAngle(0);
    });

    this.mountHudSamples();

    // The page is taller than the canvas: wheel scrolls it.
    const bottom = py + 60;
    cam.setBounds(0, 0, GAME_WIDTH, Math.max(GAME_HEIGHT, bottom));
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY + dy * 0.5, 0, Math.max(0, bottom - GAME_HEIGHT));
    });
  }

  /** For screenshots and review: scroll to a y offset. */
  scrollTo(y: number): void {
    this.cameras.main.scrollY = y;
  }

  /** DOM sample panel on the right; mirrors hud.css components. */
  private mountHudSamples(): void {
    const old = document.getElementById('style-hud');
    old?.remove();
    const root = document.createElement('div');
    root.id = 'style-hud';
    root.className = 'hud';
    root.style.cssText = 'position:fixed;top:0;right:0;width:360px;height:100vh;overflow:auto;padding:14px;box-sizing:border-box;background:rgba(0,0,0,0.25);display:flex;flex-direction:column;gap:12px;';
    root.innerHTML = `
      <div class="badge"><div class="shield">3</div><div><div class="eyebrow">YOUR HARBOR</div><div class="name">kind-harbor</div></div></div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="bar"><span class="label">BERTHS</span><div class="track"><div class="fill" style="width:38%"></div></div><span class="value">9.1 / 24</span><span class="plus">+</span></div>
        <div class="bar cargo"><span class="label">CARGO</span><div class="track"><div class="fill" style="width:62%"></div></div><span class="value">21 GiB</span><span class="plus">+</span></div>
        <div class="bar crew"><span class="label">CREW</span><div class="track"><div class="fill" style="width:18%"></div></div><span class="value">18</span><span class="plus">+</span></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="pill primary">Launch ship</button>
        <button class="pill secondary">Upgrade</button>
        <button class="pill danger">Scrap</button>
        <button class="pill" disabled>At limit</button>
      </div>
      <div style="display:flex;gap:8px"><div class="rail-btn" style="position:relative"><span class="glyph">🗺️</span>Map<span class="dot"></span></div><div class="rail-btn"><span class="glyph">⚑</span>Events</div><div class="rail-btn"><span class="glyph">📜</span>Log</div><div class="rail-btn"><span class="glyph">✥</span>Move</div></div>
      <div class="toast">⚓ Ship launched: nginx-7d9-a1</div>
      <div class="panel-dark"><b>Shipyard nginx</b><br><span style="opacity:.8;font-weight:600">sandbox · 3/3 ships moored · nginx:1.27-alpine</span></div>
      <div class="card"><b>Design tokens</b>
        <div class="swatches" style="margin-top:6px">
          <div class="swatch" style="background:var(--cream)"></div><div class="swatch" style="background:var(--olive)"></div><div class="swatch" style="background:var(--green)"></div><div class="swatch" style="background:var(--gold)"></div><div class="swatch" style="background:var(--red)"></div><div class="swatch" style="background:var(--sea)"></div><div class="swatch" style="background:var(--sea-deep)"></div>
        </div>
        <div style="margin-top:6px;font-weight:600;color:var(--ink-soft)">Nunito 200–1000 · radius 14 / 9 · olive 2px borders · 3px hard shadow</div>
      </div>
      <div class="drawer">
        <div class="tabs"><h3>Shop</h3><span class="tab active">All</span><span class="tab">Shipyards</span><span class="tab">Lighthouses</span><span class="tab">Charts</span></div>
        <div style="display:flex;gap:8px">
          <div class="shop-card selected"><div class="art">⚓</div><div class="title">Shipyard</div><div class="sub">Deployment</div><button class="pill primary">Build</button></div>
          <div class="shop-card"><div class="art">🗼</div><div class="title">Lighthouse</div><div class="sub">Service</div><button class="pill" disabled>Soon</button></div>
          <div class="shop-card"><div class="art">🗺️</div><div class="title">podinfo</div><div class="sub">chart 6.15.0</div><button class="pill secondary">Chart</button></div>
        </div>
      </div>
      <div class="map-label" style="background:#3a98c9;padding:6px;border-radius:6px">map label: harbor-worker · nginx-7d9-a1</div>`;
    document.body.append(root);
    const game = document.getElementById('game');
    if (game) game.style.width = 'calc(100vw - 360px)';
  }
}
