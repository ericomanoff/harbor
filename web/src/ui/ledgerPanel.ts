import { ledger, type LedgerEntry } from '../game/ledger';
import { openOverlay } from './overlay';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`ledger: missing ${sel}`);
  return el;
};

const hhmmss = (d: Date): string => d.toTimeString().slice(0, 8);

/** The ledger panel: who wrote what to the API server, newest first, filterable by actor. */
export function openLedger(): void {
  const root = $<HTMLDivElement>(document, '#ledger');
  const rows = $<HTMLDivElement>(root, '.rows');
  const chips = $<HTMLDivElement>(root, '.actors');
  let filter: string | undefined;
  let unsub: (() => void) | undefined;
  const close = openOverlay('ledger', () => unsub?.());
  $<HTMLButtonElement>(root, 'button[data-close]').onclick = close;
  $<HTMLButtonElement>(root, 'button[data-clear]').onclick = () => { ledger.clear(); render(); };

  const row = (e: LedgerEntry): HTMLElement => {
    const r = document.createElement('div');
    r.className = `row ${e.dir}`;
    r.dataset['who'] = e.who;
    r.append(
      Object.assign(document.createElement('span'), { className: 'time', textContent: hhmmss(e.t) }),
      Object.assign(document.createElement('span'), { className: 'who', textContent: e.who }),
      Object.assign(document.createElement('span'), { className: 'arrow', textContent: e.dir === 'request' ? '→ API server' : '← stream' }),
      Object.assign(document.createElement('span'), { className: 'what', textContent: e.what }),
    );
    return r;
  };
  const render = (): void => {
    const actors = [...new Set(ledger.entries.map((e) => e.who))];
    chips.replaceChildren(...['all', ...actors].map((a) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = `chip${(a === 'all' ? !filter : filter === a) ? ' active' : ''}`;
      c.textContent = a;
      c.onclick = () => { filter = a === 'all' ? undefined : a; render(); };
      return c;
    }));
    const list = [...ledger.entries].reverse().filter((e) => !filter || e.who === filter);
    rows.replaceChildren(...list.map(row));
    if (list.length === 0) rows.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Nothing written yet. Build something and watch who writes what.' }));
  };
  render();
  unsub = ledger.changed.on(() => render());
}
