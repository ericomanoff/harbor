import { ADVANCED } from '../levels/advanced';
import { expeditions, levelById, nextLevel, type Expedition } from '../levels/library';
import { loadProgress, type ProgressMap } from '../levels/progress';
import { startLevel, type RunOptions } from '../levels/runner';
import type { Level } from '../levels/types';
import type { MapApi } from '../hud/minimap';
import { leaveTraining, training } from '../tour/training';
import { openOverlay } from '../ui/overlay';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`harbor select: missing ${sel}`);
  return el;
};

const stars = (n: number | undefined): string => (n === undefined ? '' : '★'.repeat(n) + '☆'.repeat(3 - n));
const fmt = (s: number): string => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

/** A level is open when it is the first of its expedition or the one before it has been completed (deep links ignore this). */
export function unlocked(level: Level, progress: ProgressMap, levels: Level[] = ADVANCED): boolean {
  const prev = levels[levels.indexOf(level) - 1];
  return !prev || (progress[prev.id]?.stars ?? 0) > 0;
}

/** Starts a level from anywhere (the library, a deep link, the summary's Next). */
export function playLevel(level: Level, map: MapApi, opts: RunOptions = {}): void {
  startLevel(level, map, {
    nextLevel: (id) => nextLevel(id),
    onExit: (where) => {
      if (where === 'select') openHarborSelect(map);
    },
  }, opts);
}

export function playLevelById(id: string, map: MapApi, opts: RunOptions = {}): boolean {
  const known = levelById(id);
  if (known) {
    playLevel(known, map, opts);
    return true;
  }
  if (!id.includes('/')) return false;
  // A YAML expedition the library has not fetched yet.
  void expeditions({ demo: new URLSearchParams(location.search).has('demo') }).then(() => {
    const l = levelById(id);
    if (l) playLevel(l, map, opts);
  });
  return true;
}

function levelRow(e: Expedition, l: Level, progress: ProgressMap, map: MapApi, close: () => void, inDemo: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row level';
  row.dataset['level'] = l.id;
  const open = e.simulated ? unlocked(l, progress, e.levels) : true;
  const p = progress[l.id];
  const num = Object.assign(document.createElement('span'), { className: 'num', textContent: open ? String(l.number) : '🔒' });
  const info = document.createElement('div');
  info.className = 'info';
  info.append(Object.assign(document.createElement('b'), { textContent: l.title }), Object.assign(document.createElement('span'), { className: 'desc', textContent: l.concept + (l.practises ? ` · practises: ${l.practises}` : '') }));
  const st = Object.assign(document.createElement('span'), { className: 'stars', textContent: open ? stars(p?.stars ?? 0) : '' });
  const best = Object.assign(document.createElement('span'), { className: 'best', textContent: p?.bestSeconds ? `best ${fmt(p.bestSeconds)} · par ${fmt(l.parSeconds)}` : `par ${fmt(l.parSeconds)}` });
  const btns = document.createElement('div');
  btns.className = 'btns';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = p ? 'REPLAY' : 'PLAY';
  btn.disabled = !open;
  btn.onclick = () => { close(); playLevel(l, map); };
  btns.append(btn);
  if (p && e.simulated) {
    const ch = document.createElement('button');
    ch.type = 'button';
    ch.textContent = 'CHALLENGE';
    ch.title = 'No bubbles, just the objectives and the clock';
    ch.dataset['challenge'] = '';
    ch.onclick = () => { close(); playLevel(l, map, { challenge: true }); };
    btns.append(ch);
    if (l.real && !inDemo) {
      const real = document.createElement('button');
      real.type = 'button';
      real.textContent = 'FOR REAL';
      real.title = 'Play it on your connected cluster, in a harbor-academy namespace that is cleaned up afterwards';
      real.dataset['real'] = '';
      real.onclick = () => { close(); playLevel(l, map, { mode: 'real' }); };
      btns.append(real);
    }
  }
  row.append(num, info, st, best, btns);
  if (!open) row.classList.add('locked');
  return row;
}

/**
 * Harbor Select: the GUI's entry points (Open Harbor, your cluster) and the
 * Expeditions library with stars, locks, best times and modes per level.
 */
export function openHarborSelect(map: MapApi): void {
  const root = $<HTMLDivElement>('#expeditions');
  const close = openOverlay('expeditions');
  $('[data-close]', root).onclick = close;
  const inDemo = new URLSearchParams(location.search).has('demo');
  $('[data-open-harbor]', root).onclick = () => {
    close();
    if (inDemo) leaveTraining();
    else location.search = '?demo';
  };
  $('[data-your-cluster]', root).onclick = () => {
    close();
    if (inDemo) location.search = '';
    else leaveTraining();
  };
  $('[data-where]', root).textContent = training.active ? 'in the training harbor' : inDemo ? 'in Open Harbor' : 'in your cluster';
  const lib = $<HTMLDivElement>('.library', root);
  lib.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'reading the logbook…' }));
  void Promise.all([loadProgress(), expeditions({ demo: inDemo || training.active })]).then(([progress, list]) => {
    lib.replaceChildren(...list.map((e) => {
      const box = document.createElement('div');
      box.className = `expedition ${e.simulated ? 'sim' : 'live'}`;
      box.dataset['campaign'] = e.id;
      const title = document.createElement('div');
      title.className = 'title';
      title.append(Object.assign(document.createElement('b'), { textContent: e.title }));
      title.append(Object.assign(document.createElement('span'), { className: 'origin', textContent: e.simulated ? 'training harbor, or for real' : 'on your cluster' }));
      if (e.source) title.append(Object.assign(document.createElement('a'), { href: e.source, target: '_blank', rel: 'noopener', textContent: 'the guide ↗' }));
      box.append(title);
      if (e.tagline) box.append(Object.assign(document.createElement('div'), { className: 'tagline', textContent: e.tagline }));
      const rows = document.createElement('div');
      rows.className = 'levels';
      rows.append(...e.levels.map((l) => levelRow(e, l, progress, map, close, inDemo)));
      box.append(rows);
      return box;
    }));
    if (inDemo || training.active) lib.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Expeditions that run on a cluster (such as FortiAIGate on K8s) appear when the harbor is connected to one.' }));
  });
}
