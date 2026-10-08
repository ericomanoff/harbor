import { openOverlay } from '../ui/overlay';
import { TERMS, termById, type Term } from './terms';
import { pairLine } from './tooltip';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`glossary: missing ${sel}`);
  return el;
};

/** The glossary: every term in both languages, searchable; opens on an entry when asked. */
export function openGlossary(id?: string): void {
  const root = $<HTMLDivElement>(document, '#glossary');
  const input = $<HTMLInputElement>(root, 'input[name=q]');
  const list = $<HTMLUListElement>(root, 'ul.entries');
  const detail = $<HTMLDivElement>(root, '.detail');
  const close = openOverlay('glossary', () => { input.oninput = null; });
  $<HTMLButtonElement>(root, 'button[data-close]').onclick = close;

  const show = (t: Term): void => {
    list.querySelectorAll('li').forEach((li) => li.classList.toggle('active', li.dataset['id'] === t.id));
    detail.replaceChildren();
    const h = document.createElement('h3');
    h.textContent = pairLine(t);
    const naval = document.createElement('p');
    naval.className = 'muted';
    naval.textContent = `Harbor: ${t.naval.join(', ')}${t.k8s.length ? ` · Kubernetes: ${t.k8s.join(', ')}` : ''}`;
    const long = document.createElement('p');
    long.textContent = t.long;
    detail.append(h, naval, long);
    if (t.where) {
      const w = document.createElement('p');
      w.className = 'muted';
      w.textContent = `On the map: ${t.where}`;
      detail.append(w);
    }
    if (t.docs) {
      const a = document.createElement('a');
      a.href = t.docs;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Read the Kubernetes docs ↗';
      detail.append(a);
    }
  };
  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    const hits = TERMS.filter((t) => !q || [...t.naval, ...t.k8s, t.short].some((s) => s.toLowerCase().includes(q)));
    list.replaceChildren(...hits.map((t) => {
      const li = document.createElement('li');
      li.dataset['id'] = t.id;
      li.textContent = pairLine(t);
      li.onclick = () => show(t);
      return li;
    }));
    const first = hits[0];
    if (first && !q) show(termById(id ?? '') ?? first);
    else if (first) show(first);
    else detail.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No such term in the harbor.' }));
  };
  input.value = '';
  input.oninput = render;
  render();
  if (id) list.querySelector<HTMLLIElement>(`li[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  input.focus();
}
