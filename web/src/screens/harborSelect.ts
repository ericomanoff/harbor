import { ACADEMY, levelById } from '../levels/academy';
import { loadProgress, type ProgressMap } from '../levels/progress';
import { startLevel } from '../levels/runner';
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
export function playLevel(level: Level, map: MapApi): void {
  startLevel(level, map, {
    nextLevel: (id) => ACADEMY[ACADEMY.findIndex((l) => l.id === id) + 1],
    onExit: (where) => {
      if (where === 'select') openHarborSelect(map);
    },
  });
}

export function playLevelById(id: string, map: MapApi): boolean {
  const level = levelById(id);
  if (!level) return false;
  playLevel(level, map);
  return true;
}

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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = p ? 'REPLAY' : 'PLAY';
      btn.disabled = !open;
      btn.onclick = () => { close(); playLevel(l, map); };
      row.append(num, info, st, btn);
      if (!open) row.classList.add('locked');
      return row;
    }));
  });
}
