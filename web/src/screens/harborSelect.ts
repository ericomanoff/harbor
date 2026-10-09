import { ACADEMY, levelById } from '../levels/academy';
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

/** A level is open when it is the first or the one before it has been completed (deep links ignore this). */
export function unlocked(level: Level, progress: ProgressMap): boolean {
  const prev = ACADEMY[ACADEMY.indexOf(level) - 1];
  return !prev || (progress[prev.id]?.stars ?? 0) > 0;
}

/** Starts a level from anywhere (the select screen, a deep link, the summary's Next). */
export function playLevel(level: Level, map: MapApi, opts: RunOptions = {}): void {
  startLevel(level, map, {
    nextLevel: (id) => ACADEMY[ACADEMY.findIndex((l) => l.id === id) + 1],
    onExit: (where) => {
      if (where === 'select') openHarborSelect(map);
    },
  }, opts);
}

export function playLevelById(id: string, map: MapApi, opts: RunOptions = {}): boolean {
  const level = levelById(id);
  if (!level) return false;
  playLevel(level, map, opts);
  return true;
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

/**
 * Harbor Select: Open Harbor (the demo), your own cluster, and the academy's
 * levels with their stars and locks.
 */
export function openHarborSelect(map: MapApi): void {
  const root = $<HTMLDivElement>('#academy');
  const close = openOverlay('academy');
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
  const where = $('[data-where]', root);
  where.textContent = training.active ? 'in the training harbor' : inDemo ? 'in Open Harbor' : 'in your cluster';
  const list = $<HTMLDivElement>('.levels', root);
  list.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'reading the logbook…' }));
  void loadProgress().then((progress) => {
    list.replaceChildren(...ACADEMY.map((l) => {
      const row = document.createElement('div');
      row.className = 'row level';
      row.dataset['level'] = l.id;
      const open = unlocked(l, progress);
      const p = progress[l.id];
      const num = Object.assign(document.createElement('span'), { className: 'num', textContent: open ? String(l.number) : '🔒' });
      const info = document.createElement('div');
      info.className = 'info';
      info.append(Object.assign(document.createElement('b'), { textContent: l.title }), Object.assign(document.createElement('span'), { className: 'desc', textContent: l.concept }));
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
      if (p) {
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
    }));
  });
}
