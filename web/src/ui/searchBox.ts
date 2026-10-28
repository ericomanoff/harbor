import { selection, store } from '../app';
import { searchObjects, type SearchHit } from '../game/search';
import { openOverlay } from './overlay';

/** "/" search: type part of a name, Enter selects the first hit and pans to it. */
export function openSearch(onPick: (hit: SearchHit) => void): void {
  const root = document.getElementById('search')!;
  const input = root.querySelector<HTMLInputElement>('input')!;
  const list = root.querySelector<HTMLUListElement>('ul')!;
  let hits: SearchHit[] = [];
  let cursor = 0;

  const close = openOverlay('search', () => {
    input.oninput = null;
    input.onkeydown = null;
  });

  const render = (): void => {
    hits = searchObjects(input.value, store);
    cursor = Math.min(cursor, Math.max(0, hits.length - 1));
    list.replaceChildren(...hits.map((h, i) => {
      const li = document.createElement('li');
      li.textContent = `${h.kind === 'structure' ? '▣' : h.kind === 'service' ? '◎' : h.kind === 'workload' ? '⚓' : h.kind === 'gate' ? '⛩' : h.kind === 'island' ? '🏝' : '▪'} ${h.ns ? `${h.ns}/` : ''}${h.name}`;
      li.className = i === cursor ? 'active' : '';
      li.onmousedown = () => pick(h);
      return li;
    }));
  };
  const pick = (h: SearchHit): void => {
    selection.set([h.key]);
    onPick(h);
    close();
  };

  input.value = '';
  input.oninput = () => { cursor = 0; render(); };
  input.onkeydown = (ev) => {
    if (ev.key === 'ArrowDown') { cursor = Math.min(cursor + 1, hits.length - 1); render(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { cursor = Math.max(cursor - 1, 0); render(); ev.preventDefault(); }
    else if (ev.key === 'Enter') { const h = hits[cursor]; if (h) pick(h); ev.preventDefault(); }
  };
  render();
  input.focus();
}
