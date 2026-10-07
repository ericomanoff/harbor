import Phaser from 'phaser';
import { deleteDeployment, deletePod, scaleDeployment } from '../api/client';
import { eva, link, mode, selection, settings, store, type LinkStatus } from '../app';
import { FONT, GAME_HEIGHT, GAME_WIDTH, MAP_W, PALETTE, SIDEBAR_W } from '../config';
import { sellPlan } from '../game/commands';
import { EvaFeed, clipLine } from '../game/eva';
import { computePower, formatPower, type PowerLevel } from '../game/power';
import { hexString, namespaceColor } from '../layout/colors';
import { namespaceVisible, filterSummary } from '../game/filter';
import { sfx } from '../game/audio';
import { voiceLineFor } from '../game/voice';
import { openFilter } from '../ui/filterPanel';
import { BUILD_CELL, TILE } from '../layout/grid';
import type { StoreEvent } from '../store/cluster';
import { Button } from '../ui/Button';
import type { MapScene } from './MapScene';

const PAD = 8;
const X = MAP_W + PAD;
const W = SIDEBAR_W - 2 * PAD;
const POWER = { y: 38, h: 8 };
const RADAR = { x: X, y: 52, w: W, h: 104 };
const BUILD = { y: 176, h: 44, w: 88 };
const INFO = { y: 232, h: 222 };
/** Three command rows at the bottom of the selection panel. */
export const CMD = { x: X + 2, w: W - 4, h: 22, gap: 4, y: INFO.y + INFO.h - 3 * 22 - 2 * 4 - 4 };
const TOGGLE_Y = 462;
const LOG = { y: 476, h: 116 };
const LOG_LINES = 9;
const CONFIRM_MS = 4000;

const TEXT = { fontFamily: FONT, fontSize: '10px', color: '#c8c8b0' };

interface Action {
  label: string;
  enabled: boolean;
  run?: () => Promise<void>;
  /** Dangerous actions ask for a second click within CONFIRM_MS. */
  confirm?: string;
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
  private buttons!: Button[];
  private actions: (Action | undefined)[] = [];
  private pendingConfirm?: { index: number; until: number };
  private feed = new EvaFeed(store);
  private soundText!: Phaser.GameObjects.Text;
  private powerLevel: PowerLevel = 'ok';
  readonly log: string[] = [];

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
    const colors = [PALETTE.radarGreen, PALETTE.amber, PALETTE.alert];
    this.buttons = colors.map((color, i) =>
      new Button(this, CMD.x, CMD.y + i * (CMD.h + CMD.gap), CMD.w, CMD.h, '', () => void this.run(i), color));

    this.toggleText = this.add.text(X, TOGGLE_Y, '', { ...TEXT, color: hexString(PALETTE.amber) })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => openFilter());
    this.soundText = this.add.text(GAME_WIDTH - PAD, TOGGLE_Y, '', { ...TEXT, color: hexString(PALETTE.amber) }).setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        settings.sound = !settings.sound;
        sfx.setEnabled(settings.sound);
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

  update(time: number): void {
    if (this.pendingConfirm && time > this.pendingConfirm.until) {
      this.pendingConfirm = undefined;
      this.refreshButtons();
    }
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
    const show = (ns: string): boolean => namespaceVisible(ns, settings);
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

  private drawPower(): void {
    const p = computePower(store.nodes.values());
    const colors: Record<PowerLevel, number> = { ok: PALETTE.radarGreen, low: PALETTE.amber, critical: PALETTE.alert };
    const color = colors[p.level];
    const x = X + 26;
    const w = W - 26 - 54;
    const g = this.power;
    g.clear();
    g.fillStyle(0x000000, 1).fillRect(x, POWER.y, w, POWER.h);
    g.lineStyle(1, PALETTE.bevelDark, 1).strokeRect(x + 0.5, POWER.y + 0.5, w - 1, POWER.h - 1);
    g.fillStyle(color, 1).fillRect(x + 1, POWER.y + 1, Math.max(0, Math.min(1, p.frac) * (w - 2)), POWER.h - 2);
    this.powerText.setText(formatPower(p)).setColor(hexString(color));
    if (p.level !== this.powerLevel) {
      this.powerLevel = p.level;
      if (p.level === 'critical') this.eva('INSUFFICIENT POWER');
      else if (p.level === 'low') this.eva('LOW POWER');
    }
  }

  private setLink(s: LinkStatus): void {
    const label: Record<LinkStatus, string> = { connecting: 'LINK ...', online: 'LINK OK', offline: 'LINK LOST', demo: 'DEMO' };
    const color: Record<LinkStatus, number> = { connecting: PALETTE.amber, online: PALETTE.radarGreen, offline: PALETTE.alert, demo: PALETTE.amber };
    this.linkText.setText(label[s]).setColor(hexString(color[s]));
    if (s === 'offline') this.eva('LINK TO BACKEND LOST');
  }

  private refreshToggle(): void {
    this.toggleText.setText(`[F] ${filterSummary(store.namespaces.keys(), settings)}`);
    this.soundText.setText(`[M] SND ${settings.sound ? 'ON' : 'OFF'}`);
  }

  // ---- selection and commands -------------------------------------------

  private async run(i: number): Promise<void> {
    const a = this.actions[i];
    if (!a?.run || !a.enabled) return;
    sfx.play('click');
    if (a.confirm && this.pendingConfirm?.index !== i) {
      this.pendingConfirm = { index: i, until: this.time.now + CONFIRM_MS };
      this.refreshButtons();
      return;
    }
    this.pendingConfirm = undefined;
    this.refreshButtons();
    try {
      await a.run();
    } catch (e) {
      this.eva(`UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private setActions(...actions: (Action | undefined)[]): void {
    this.actions = actions;
    this.pendingConfirm = undefined;
    this.refreshButtons();
  }

  private refreshButtons(): void {
    this.buttons.forEach((b, i) => {
      const a = this.actions[i];
      const confirming = this.pendingConfirm?.index === i;
      b.setVisible(!!a).setLabel(confirming ? (a?.confirm ?? '') : (a?.label ?? '')).setEnabled(!!a?.enabled);
    });
  }

  private refreshInfo(): void {
    if (mode.current === 'place') {
      this.infoText.setText('PLACE WAR FACTORY\n\nClick a free building cell on a\nplateau (top rows). Green = ok.\n\nRight-click or Esc cancels.');
      this.setActions({ label: 'CANCEL PLACEMENT', enabled: true, run: async () => mode.set('idle') });
      return;
    }
    const keys = [...selection.keys];
    if (keys.length === 0) {
      this.infoText.setText('Click a structure or unit.\nDrag to box-select units.\nDrag a structure to move it.\nTab cycles the selection.\n\n[B] place a War Factory\n[/] locate  [F] filter  [M] sound\nRight-drag pans, wheel zooms,\nH homes the camera.');
      this.setActions();
      return;
    }
    const k0 = keys[0]!;
    if (keys.length === 1 && k0.startsWith('b:')) {
      const d = store.deployments.get(k0.slice(2));
      if (!d) return;
      const rolling = d.replicas > 0 && d.updated < d.replicas;
      this.infoText.setText([
        'WAR FACTORY',
        d.name,
        `ns: ${d.ns}`,
        `image: ${d.image}`,
        `units: ${d.available}/${d.replicas} ready`,
        rolling ? `ROLLOUT: ${d.updated}/${d.replicas} on new template` : `updated: ${d.updated}`,
        d.mapPos ? `site ${d.mapPos.x},${d.mapPos.y}` : 'auto-placed (drag to site)',
      ].join('\n'));
      this.setActions(
        { label: 'BUILD UNIT  (+1)', enabled: true, run: async () => { await scaleDeployment(d.ns, d.name, d.replicas + 1); this.eva(`UNIT ORDERED: ${d.name}`); } },
        { label: 'RETIRE UNIT  (-1)', enabled: d.replicas > 0, run: async () => { await scaleDeployment(d.ns, d.name, d.replicas - 1); this.eva(`UNIT RETIRED: ${d.name}`); } },
        { label: 'SELL STRUCTURE', confirm: 'CONFIRM: SELL AND LOSE UNITS?', enabled: true, run: async () => { await deleteDeployment(d.ns, d.name); this.eva(`STRUCTURE SOLD: ${d.name}`); selection.clear(); } },
      );
      return;
    }
    const pods = keys.filter((k) => k.startsWith('u:')).map((k) => store.pods.get(k.slice(2))).filter((p) => !!p);
    if (pods.length === 1) {
      const p = pods[0]!;
      const dep = p.deployment ? store.deployments.get(`${p.ns}/${p.deployment}`) : undefined;
      const old = !!(dep?.currentRS && p.ownerRS && p.ownerRS !== dep.currentRS);
      this.infoText.setText([
        'UNIT',
        p.name,
        `ns: ${p.ns}`,
        `node: ${p.node || '(unscheduled)'}`,
        `phase: ${p.phase}${p.ready ? ' READY' : ''}`,
        `restarts: ${p.restarts}`,
        p.reason ? `!! ${p.reason}` : '',
        p.deployment ? `from: ${p.deployment}${old ? ' (old template)' : ''}` : 'no factory',
      ].filter(Boolean).join('\n'));
    } else {
      this.infoText.setText(`${pods.length} UNITS SELECTED`);
    }
    const plan = sellPlan(pods, store.deployments);
    this.setActions(
      {
        label: plan.sellable ? `SELL ${pods.length} UNIT${pods.length > 1 ? 'S' : ''}` : 'NOT SELLABLE (no factory)',
        enabled: plan.sellable,
        run: async () => {
          for (const g of plan.groups) await scaleDeployment(g.ns, g.deployment, g.target, g.names);
          this.eva(`UNIT${pods.length > 1 ? 'S' : ''} SOLD`);
          selection.clear();
        },
      },
      {
        label: `REPAIR ${pods.length > 1 ? `${pods.length} UNITS` : 'UNIT'} (replace)`,
        enabled: pods.length > 0,
        run: async () => {
          for (const p of pods) await deletePod(p.ns, p.name);
          this.eva('REPAIR ORDERED');
          selection.clear();
        },
      },
    );
  }

  // ---- store feed --------------------------------------------------------

  private onStore(e: StoreEvent): void {
    for (const line of this.feed.announce(e)) this.eva(line);
    if (e.type === 'snapshot') this.contextText.setText(store.context ? `THEATER: ${store.context}` : 'NO THEATER');
    if (e.type === 'snapshot' || e.type === 'namespace') this.refreshToggle();
    if (e.type === 'snapshot' || e.type === 'node') this.drawPower();
    if (e.type === 'event' && e.event.type === 'Warning') this.map().flashFor(e.event);
    this.refreshInfo();
  }

  private eva(line: string): void {
    const voice = voiceLineFor(line);
    if (/^UNABLE|^CANNOT|^INSUFFICIENT|^LINK/.test(line)) sfx.play('error');
    else if (/under attack/.test(voice ?? '')) sfx.play('alert');
    else if (/^CONSTRUCTION STARTED|^UNIT ORDERED/.test(line)) sfx.play('build');
    else if (/^CONSTRUCTION COMPLETE|^UNIT DEPLOYED/.test(line)) sfx.play('ok');
    sfx.say(voice);
    this.log.push(clipLine(line));
    if (this.log.length > LOG_LINES) this.log.splice(0, this.log.length - LOG_LINES);
    this.logText.setText(this.log.join('\n'));
  }
}
