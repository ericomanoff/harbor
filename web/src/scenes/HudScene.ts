import Phaser from 'phaser';
import { link, selection, settings, store, type LinkStatus } from '../app';
import { FONT, GAME_HEIGHT, GAME_WIDTH, MAP_W, PALETTE, SIDEBAR_W } from '../config';
import { hexString, isSystemNamespace, namespaceColor } from '../layout/colors';
import { BUILD_CELL, TILE } from '../layout/grid';
import type { StoreEvent } from '../store/cluster';
import type { MapScene } from './MapScene';

const PAD = 8;
const RADAR = { x: MAP_W + PAD, y: 44, w: SIDEBAR_W - 2 * PAD, h: 124 };
const INFO_Y = RADAR.y + RADAR.h + 10;
const LOG_LINES = 9;

const TEXT = { fontFamily: FONT, fontSize: '10px', color: '#c8c8b0' };

/** The C&C sidebar: radar, selection readout, toggles, and the EVA log. */
export class HudScene extends Phaser.Scene {
  private radar!: Phaser.GameObjects.Graphics;
  private contextText!: Phaser.GameObjects.Text;
  private linkText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private toggleText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private readonly log: string[] = [];
  private readonly seenDeps = new Set<string>();
  private readonly seenPods = new Set<string>();

  constructor() {
    super('Hud');
  }

  create(): void {
    this.drawChrome();
    this.add.text(MAP_W + PAD, 6, 'HARBOR', { fontFamily: FONT, fontSize: '16px', color: hexString(PALETTE.radarGreen) });
    this.contextText = this.add.text(MAP_W + PAD, 24, '', { ...TEXT, color: '#e8e8d0' });
    this.linkText = this.add.text(GAME_WIDTH - PAD, 8, '', { ...TEXT, color: hexString(PALETTE.amber) }).setOrigin(1, 0);

    this.radar = this.add.graphics();
    this.add.zone(RADAR.x, RADAR.y, RADAR.w, RADAR.h).setOrigin(0).setInteractive()
      .on('pointerdown', (p: Phaser.Input.Pointer) => this.radarJump(p));

    this.add.text(MAP_W + PAD, INFO_Y, 'SELECTION', { ...TEXT, color: '#8a8a70' });
    this.infoText = this.add.text(MAP_W + PAD, INFO_Y + 14, '', { ...TEXT, wordWrap: { width: SIDEBAR_W - 2 * PAD } });

    this.toggleText = this.add.text(MAP_W + PAD, GAME_HEIGHT - 150, '', { ...TEXT, color: hexString(PALETTE.amber) })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        settings.showSystemNamespaces = !settings.showSystemNamespaces;
        settings.changed.emit();
      });
    this.add.text(MAP_W + PAD, GAME_HEIGHT - 134, 'EVA LOG', { ...TEXT, color: '#8a8a70' });
    this.logText = this.add.text(MAP_W + PAD, GAME_HEIGHT - 120, '', { ...TEXT, fontSize: '9px', color: hexString(PALETTE.radarGreen) });

    store.subscribe((e) => this.onStore(e));
    link.changed.on((s) => this.setLink(s));
    selection.changed.on(() => this.refreshInfo());
    settings.changed.on(() => this.refreshToggle());

    this.setLink(link.status);
    this.refreshToggle();
    this.refreshInfo();
    this.onStore({ type: 'snapshot' });
    this.time.addEvent({ delay: 150, loop: true, callback: () => this.drawRadar() });
  }

  private drawChrome(): void {
    const g = this.add.graphics();
    g.fillStyle(PALETTE.black, 1).fillRect(MAP_W, 0, SIDEBAR_W, GAME_HEIGHT);
    g.lineStyle(2, PALETTE.bevelLight, 1).lineBetween(MAP_W + 1, 0, MAP_W + 1, GAME_HEIGHT);
    g.lineStyle(1, PALETTE.bevelDark, 1).lineBetween(MAP_W + 3, 0, MAP_W + 3, GAME_HEIGHT);
    const bevel = (x: number, y: number, w: number, h: number): void => {
      g.lineStyle(1, PALETTE.bevelDark, 1).strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
      g.lineStyle(1, PALETTE.bevelLight, 1).strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    };
    bevel(RADAR.x, RADAR.y, RADAR.w, RADAR.h);
    bevel(MAP_W + PAD, INFO_Y, SIDEBAR_W - 2 * PAD, GAME_HEIGHT - 160 - INFO_Y);
    bevel(MAP_W + PAD, GAME_HEIGHT - 136, SIDEBAR_W - 2 * PAD, 128);
  }

  private map(): MapScene {
    return this.scene.get('Map') as MapScene;
  }

  private radarScale(): { s: number; ox: number; oy: number } {
    const L = this.map().layout;
    const s = Math.min(RADAR.w / (L.width * TILE), RADAR.h / (L.height * TILE));
    return { s, ox: RADAR.x + (RADAR.w - L.width * TILE * s) / 2, oy: RADAR.y + (RADAR.h - L.height * TILE * s) / 2 };
  }

  private drawRadar(): void {
    const map = this.map();
    if (!map.sys.isActive()) return;
    const L = map.layout;
    const { s, ox, oy } = this.radarScale();
    const g = this.radar;
    g.clear();
    g.fillStyle(PALETTE.radarGround, 1).fillRect(RADAR.x, RADAR.y, RADAR.w, RADAR.h);
    for (const p of L.plateaus) {
      g.fillStyle(p.ready ? 0x1f5a1f : 0x5a1f1f, 1);
      g.fillRect(ox + p.x * TILE * s, oy + p.y * TILE * s, p.w * TILE * s, p.h * TILE * s);
    }
    const show = (ns: string): boolean => settings.showSystemNamespaces || !isSystemNamespace(ns);
    for (const [key, pl] of L.buildings) {
      const ns = key.split('/')[0] ?? '';
      if (!show(ns)) continue;
      g.fillStyle(namespaceColor(ns), 1);
      g.fillRect(ox + pl.x * TILE * s, oy + pl.y * TILE * s, Math.max(2, BUILD_CELL * TILE * s), Math.max(2, BUILD_CELL * TILE * s));
    }
    for (const [key, pl] of L.units) {
      const ns = key.split('/')[0] ?? '';
      if (!show(ns)) continue;
      g.fillStyle(namespaceColor(ns), 1);
      g.fillRect(ox + pl.x * TILE * s, oy + pl.y * TILE * s, Math.max(1, TILE * s), Math.max(1, TILE * s));
    }
    const cam = map.cameras.main;
    const view = cam.worldView;
    g.lineStyle(1, PALETTE.radarGreen, 1);
    g.strokeRect(ox + view.x * s, oy + view.y * s, view.width * s, view.height * s);
  }

  private radarJump(p: Phaser.Input.Pointer): void {
    const { s, ox, oy } = this.radarScale();
    this.map().centerOnWorld((p.x - ox) / s, (p.y - oy) / s);
  }

  private setLink(s: LinkStatus): void {
    const label: Record<LinkStatus, string> = { connecting: 'LINK ...', online: 'LINK OK', offline: 'LINK LOST', demo: 'DEMO' };
    const color: Record<LinkStatus, number> = { connecting: PALETTE.amber, online: PALETTE.radarGreen, offline: PALETTE.alert, demo: PALETTE.amber };
    this.linkText.setText(label[s]).setColor(hexString(color[s]));
    if (s === 'offline') this.eva('LINK TO BACKEND LOST');
  }

  private refreshToggle(): void {
    this.toggleText.setText(`[N] SYSTEM NS: ${settings.showSystemNamespaces ? 'SHOWN' : 'HIDDEN'}`);
  }

  private refreshInfo(): void {
    const keys = [...selection.keys];
    if (keys.length === 0) {
      this.infoText.setText('Click a structure or unit.\nDrag to box-select units.\n\nRight-drag pans, wheel zooms,\nH homes the camera.');
      return;
    }
    if (keys.length > 1) {
      this.infoText.setText(`${keys.length} UNITS SELECTED`);
      return;
    }
    const k = keys[0]!;
    const key = k.slice(2);
    if (k.startsWith('b:')) {
      const d = store.deployments.get(key);
      if (!d) return;
      this.infoText.setText([
        `WAR FACTORY`,
        `${d.name}`,
        `ns: ${d.ns}`,
        `image: ${d.image}`,
        `units: ${d.available}/${d.replicas} ready`,
        `updated: ${d.updated}`,
        d.mapPos ? `placed at ${d.mapPos.x},${d.mapPos.y}` : 'auto-placed',
      ].join('\n'));
      return;
    }
    const p = store.pods.get(key);
    if (!p) return;
    this.infoText.setText([
      `UNIT`,
      `${p.name}`,
      `ns: ${p.ns}`,
      `node: ${p.node || '(unscheduled)'}`,
      `phase: ${p.phase}${p.ready ? ' READY' : ''}`,
      `restarts: ${p.restarts}`,
      p.reason ? `!! ${p.reason}` : '',
      p.deployment ? `from: ${p.deployment}` : 'no factory',
    ].filter(Boolean).join('\n'));
  }

  private onStore(e: StoreEvent): void {
    switch (e.type) {
      case 'snapshot':
        this.contextText.setText(store.context ? `THEATER: ${store.context}` : 'NO THEATER');
        this.seenDeps.clear();
        this.seenPods.clear();
        for (const k of store.deployments.keys()) this.seenDeps.add(k);
        for (const k of store.pods.keys()) this.seenPods.add(k);
        if (store.context) this.eva(`BATTLEFIELD CONTROL ESTABLISHED`);
        break;
      case 'deployment':
        if (e.op === 'delete') {
          this.seenDeps.delete(e.key);
          this.eva(`STRUCTURE SOLD: ${e.key}`);
        } else if (!this.seenDeps.has(e.key)) {
          this.seenDeps.add(e.key);
          this.eva(`NEW CONSTRUCTION: ${e.key}`);
        }
        break;
      case 'pod':
        if (e.op === 'delete') {
          this.seenPods.delete(e.key);
          this.eva(`UNIT LOST: ${e.key.split('/')[1]}`);
        } else if (!this.seenPods.has(e.key)) {
          this.seenPods.add(e.key);
          this.eva(`UNIT DEPLOYED: ${e.key.split('/')[1]}`);
        }
        break;
      case 'event':
        if (e.event.type === 'Warning') this.eva(`${e.event.reason}: ${e.event.name}`);
        break;
      default:
        break;
    }
    this.refreshInfo();
  }

  private eva(line: string): void {
    const max = 30;
    this.log.push(line.length > max ? `${line.slice(0, max - 1)}…` : line);
    if (this.log.length > LOG_LINES) this.log.splice(0, this.log.length - LOG_LINES);
    this.logText.setText(this.log.join('\n'));
  }
}
