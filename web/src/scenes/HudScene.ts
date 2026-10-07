import Phaser from 'phaser';
import { scaleDeployment } from '../api/client';
import { eva, link, mode, selection, settings, store, type LinkStatus } from '../app';
import { FONT, GAME_HEIGHT, GAME_WIDTH, MAP_W, PALETTE, SIDEBAR_W } from '../config';
import { hexString, isSystemNamespace, namespaceColor } from '../layout/colors';
import { BUILD_CELL, TILE } from '../layout/grid';
import { nsKey, type StoreEvent } from '../store/cluster';
import { Button } from '../ui/Button';
import type { MapScene } from './MapScene';

const PAD = 8;
const X = MAP_W + PAD;
const W = SIDEBAR_W - 2 * PAD;
const POWER = { y: 38, h: 8 };
const RADAR = { x: X, y: 52, w: W, h: 104 };
const BUILD = { y: 176, h: 44, w: 88 };
const INFO = { y: 232, h: 222 };
const CMD = { y: INFO.y + INFO.h - 52, h: 22 };
const TOGGLE_Y = 462;
const LOG = { y: 476, h: 116 };
const LOG_LINES = 9;

const TEXT = { fontFamily: FONT, fontSize: '10px', color: '#c8c8b0' };

interface Action {
  label: string;
  enabled: boolean;
  run?: () => Promise<void>;
}

/** The C&C sidebar: power, radar, build strip, selection and commands, EVA log. */
export class HudScene extends Phaser.Scene {
  private power!: Phaser.GameObjects.Graphics;
  private powerText!: Phaser.GameObjects.Text;
  private radar!: Phaser.GameObjects.Graphics;
  private cameo!: Phaser.GameObjects.Graphics;
  private contextText!: Phaser.GameObjects.Text;
  private linkText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private toggleText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private primary!: Button;
  private secondary!: Button;
  private actions: { primary?: Action; secondary?: Action } = {};
  readonly log: string[] = [];
  private readonly seenDeps = new Set<string>();
  private readonly seenPods = new Set<string>();
  private readonly avail = new Map<string, number>();

  constructor() {
    super('Hud');
  }

  create(): void {
    this.drawChrome();
    this.add.text(X, 6, 'HARBOR', { fontFamily: FONT, fontSize: '16px', color: hexString(PALETTE.radarGreen) });
    this.contextText = this.add.text(X, 24, '', { ...TEXT, color: '#e8e8d0' });
    this.linkText = this.add.text(GAME_WIDTH - PAD, 8, '', { ...TEXT, color: hexString(PALETTE.amber) }).setOrigin(1, 0);

    this.add.text(X, POWER.y - 1, 'PWR', { ...TEXT, fontSize: '9px', color: '#8a8a70' });
    this.power = this.add.graphics();
    this.powerText = this.add.text(GAME_WIDTH - PAD, POWER.y - 1, '', { ...TEXT, fontSize: '9px' }).setOrigin(1, 0);

    this.radar = this.add.graphics();
    this.add.zone(RADAR.x, RADAR.y, RADAR.w, RADAR.h).setOrigin(0).setInteractive()
      .on('pointerdown', (p: Phaser.Input.Pointer) => this.radarJump(p));

    this.add.text(X, BUILD.y - 12, 'BUILD', { ...TEXT, color: '#8a8a70' });
    this.cameo = this.add.graphics();
    this.add.text(X + BUILD.w / 2, BUILD.y + BUILD.h / 2 + 8, 'WAR FACTORY', { ...TEXT, fontSize: '9px', color: '#e8e8d0' }).setOrigin(0.5);
    this.add.zone(X, BUILD.y, BUILD.w, BUILD.h).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => mode.set(mode.current === 'place' ? 'idle' : 'place'));
    this.add.text(X + W - BUILD.w / 2, BUILD.y + BUILD.h / 2, 'TECH TREE\n(helm, soon)', { ...TEXT, fontSize: '9px', color: '#555550', align: 'center' }).setOrigin(0.5);

    this.add.text(X, INFO.y + 2, 'SELECTION', { ...TEXT, color: '#8a8a70' });
    this.infoText = this.add.text(X, INFO.y + 16, '', { ...TEXT, wordWrap: { width: W } });
    this.primary = new Button(this, X + 2, CMD.y, W - 4, CMD.h, '', () => this.run(this.actions.primary));
    this.secondary = new Button(this, X + 2, CMD.y + CMD.h + 4, W - 4, CMD.h, '', () => this.run(this.actions.secondary), PALETTE.amber);

    this.toggleText = this.add.text(X, TOGGLE_Y, '', { ...TEXT, color: hexString(PALETTE.amber) })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        settings.showSystemNamespaces = !settings.showSystemNamespaces;
        settings.changed.emit();
      });
    this.add.text(X, LOG.y + 2, 'EVA LOG', { ...TEXT, color: '#8a8a70' });
    this.logText = this.add.text(X, LOG.y + 14, '', { ...TEXT, fontSize: '9px', color: hexString(PALETTE.radarGreen) });

    store.subscribe((e) => this.onStore(e));
    link.changed.on((s) => this.setLink(s));
    selection.changed.on(() => this.refreshInfo());
    settings.changed.on(() => this.refreshToggle());
    mode.changed.on(() => {
      this.drawCameo();
      this.refreshInfo();
    });
    eva.on((line) => this.eva(line));

    this.setLink(link.status);
    this.refreshToggle();
    this.drawCameo();
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
    bevel(X + W - BUILD.w, BUILD.y, BUILD.w, BUILD.h);
    bevel(X, INFO.y, W, INFO.h);
    bevel(X, LOG.y, W, LOG.h);
  }

  private drawCameo(): void {
    const g = this.cameo;
    const active = mode.current === 'place';
    g.clear();
    g.fillStyle(active ? 0x1a2a14 : 0x101010, 1).fillRect(X, BUILD.y, BUILD.w, BUILD.h);
    g.lineStyle(1, active ? PALETTE.radarGreen : PALETTE.bevelLight, 1).strokeRect(X + 0.5, BUILD.y + 0.5, BUILD.w - 1, BUILD.h - 1);
    // Cameo icon: a little factory.
    const ix = X + BUILD.w / 2 - 14;
    const iy = BUILD.y + 6;
    g.fillStyle(0x3a3a30, 1).fillRect(ix, iy + 8, 28, 12);
    g.fillStyle(PALETTE.amber, 1).fillRect(ix + 2, iy, 6, 10).fillRect(ix + 11, iy + 3, 6, 7);
    g.fillStyle(0x000000, 1).fillRect(ix + 20, iy + 13, 6, 7);
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
    const view = map.cameras.main.worldView;
    g.lineStyle(1, PALETTE.radarGreen, 1);
    g.strokeRect(ox + view.x * s, oy + view.y * s, view.width * s, view.height * s);
  }

  private radarJump(p: Phaser.Input.Pointer): void {
    const { s, ox, oy } = this.radarScale();
    this.map().centerOnWorld((p.x - ox) / s, (p.y - oy) / s);
  }

  /** Power = CPU requests over allocatable across ready nodes, C&C style. */
  private drawPower(): void {
    let req = 0;
    let alloc = 0;
    for (const n of store.nodes.values()) {
      if (!n.ready) continue;
      req += n.cpuReq;
      alloc += n.cpuAlloc;
    }
    const frac = alloc > 0 ? req / alloc : 0;
    const color = frac < 0.6 ? PALETTE.radarGreen : frac < 0.85 ? PALETTE.amber : PALETTE.alert;
    const x = X + 26;
    const w = W - 26 - 54;
    const g = this.power;
    g.clear();
    g.fillStyle(0x000000, 1).fillRect(x, POWER.y, w, POWER.h);
    g.lineStyle(1, PALETTE.bevelDark, 1).strokeRect(x + 0.5, POWER.y + 0.5, w - 1, POWER.h - 1);
    g.fillStyle(color, 1).fillRect(x + 1, POWER.y + 1, Math.max(0, Math.min(1, frac) * (w - 2)), POWER.h - 2);
    this.powerText.setText(alloc ? `${Math.round(frac * 100)}%  ${(req / 1000).toFixed(1)}/${(alloc / 1000).toFixed(0)} cpu` : 'no power').setColor(hexString(color));
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

  // ---- selection and commands -------------------------------------------

  private async run(a?: Action): Promise<void> {
    if (!a?.run || !a.enabled) return;
    try {
      await a.run();
    } catch (e) {
      this.eva(`UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private setActions(primary?: Action, secondary?: Action): void {
    this.actions = { primary, secondary };
    this.primary.setVisible(!!primary).setLabel(primary?.label ?? '').setEnabled(!!primary?.enabled);
    this.secondary.setVisible(!!secondary).setLabel(secondary?.label ?? '').setEnabled(!!secondary?.enabled);
  }

  private refreshInfo(): void {
    if (mode.current === 'place') {
      this.infoText.setText('PLACE WAR FACTORY\n\nClick a free building cell on a\nplateau (top rows). Green = ok.\n\nRight-click or Esc cancels.');
      this.setActions({ label: 'CANCEL PLACEMENT', enabled: true, run: async () => mode.set('idle') });
      return;
    }
    const keys = [...selection.keys];
    if (keys.length === 0) {
      this.infoText.setText('Click a structure or unit.\nDrag to box-select units.\nDrag a structure to move it.\n\n[B] place a War Factory.\nRight-drag pans, wheel zooms,\nH homes the camera.');
      this.setActions();
      return;
    }
    const k0 = keys[0]!;
    if (keys.length === 1 && k0.startsWith('b:')) {
      const d = store.deployments.get(k0.slice(2));
      if (!d) return;
      this.infoText.setText([
        'WAR FACTORY',
        d.name,
        `ns: ${d.ns}`,
        `image: ${d.image}`,
        `units: ${d.available}/${d.replicas} ready`,
        `updated: ${d.updated}`,
        d.mapPos ? `site ${d.mapPos.x},${d.mapPos.y}` : 'auto-placed (drag to site)',
      ].join('\n'));
      this.setActions(
        { label: 'BUILD UNIT  (+1)', enabled: true, run: async () => { await scaleDeployment(d.ns, d.name, d.replicas + 1); this.eva(`UNIT ORDERED: ${d.name}`); } },
        { label: 'RETIRE UNIT  (-1)', enabled: d.replicas > 0, run: async () => { await scaleDeployment(d.ns, d.name, d.replicas - 1); this.eva(`UNIT RETIRED: ${d.name}`); } },
      );
      return;
    }
    const pods = keys.filter((k) => k.startsWith('u:')).map((k) => store.pods.get(k.slice(2))).filter((p) => !!p);
    if (pods.length === 1) {
      const p = pods[0]!;
      this.infoText.setText([
        'UNIT',
        p.name,
        `ns: ${p.ns}`,
        `node: ${p.node || '(unscheduled)'}`,
        `phase: ${p.phase}${p.ready ? ' READY' : ''}`,
        `restarts: ${p.restarts}`,
        p.reason ? `!! ${p.reason}` : '',
        p.deployment ? `from: ${p.deployment}` : 'no factory',
      ].filter(Boolean).join('\n'));
    } else {
      this.infoText.setText(`${pods.length} UNITS SELECTED`);
    }
    // Sell: group by factory, scale each down by the count, retiring exactly these pods.
    const groups = new Map<string, { ns: string; dep: string; names: string[] }>();
    let sellable = pods.length > 0;
    for (const p of pods) {
      if (!p.deployment) {
        sellable = false;
        break;
      }
      const g = groups.get(nsKey(p.ns, p.deployment)) ?? { ns: p.ns, dep: p.deployment, names: [] };
      g.names.push(p.name);
      groups.set(nsKey(p.ns, p.deployment), g);
    }
    this.setActions({
      label: sellable ? `SELL ${pods.length} UNIT${pods.length > 1 ? 'S' : ''}` : 'NOT SELLABLE (no factory)',
      enabled: sellable,
      run: async () => {
        for (const g of groups.values()) {
          const d = store.deployments.get(nsKey(g.ns, g.dep));
          if (!d) continue;
          await scaleDeployment(g.ns, g.dep, Math.max(0, d.replicas - g.names.length), g.names);
        }
        this.eva(`UNIT${pods.length > 1 ? 'S' : ''} SOLD`);
        selection.clear();
      },
    });
  }

  // ---- store feed --------------------------------------------------------

  private onStore(e: StoreEvent): void {
    switch (e.type) {
      case 'snapshot':
        this.contextText.setText(store.context ? `THEATER: ${store.context}` : 'NO THEATER');
        this.seenDeps.clear();
        this.seenPods.clear();
        this.avail.clear();
        for (const [k, d] of store.deployments) {
          this.seenDeps.add(k);
          this.avail.set(k, d.available);
        }
        for (const k of store.pods.keys()) this.seenPods.add(k);
        if (store.context) this.eva('BATTLEFIELD CONTROL ESTABLISHED');
        this.drawPower();
        break;
      case 'node':
        this.drawPower();
        break;
      case 'deployment': {
        const d = store.deployments.get(e.key);
        if (e.op === 'delete') {
          this.seenDeps.delete(e.key);
          this.avail.delete(e.key);
          this.eva(`STRUCTURE SOLD: ${e.key}`);
        } else if (!this.seenDeps.has(e.key)) {
          this.seenDeps.add(e.key);
          this.eva(`NEW CONSTRUCTION: ${e.key}`);
        } else if (d && this.avail.get(e.key) === 0 && d.available > 0) {
          this.eva(`CONSTRUCTION COMPLETE: ${d.name}`);
        }
        if (d) this.avail.set(e.key, d.available);
        break;
      }
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
