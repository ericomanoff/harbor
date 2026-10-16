import { openOverlay } from '../ui/overlay';
import { isHarborOnly, TERMS, termById, titleOf, type Term } from './terms';

/** Kubernetes terms alphabetically, then the harbor-only words. */
const ORDERED: Term[] = [...TERMS].sort((a, b) => Number(isHarborOnly(a)) - Number(isHarborOnly(b)) || titleOf(a).localeCompare(titleOf(b)));

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
    h.textContent = titleOf(t);
    const names = document.createElement('p');
    names.className = 'muted';
    names.textContent = `${t.k8s.length ? `Kubernetes: ${t.k8s.join(', ')} · ` : ''}Harbor: ${t.naval.join(', ')}`;
    const concept = document.createElement('p');
    concept.textContent = t.concept;
    detail.append(h, names, concept);
    if (t.detail) detail.append(Object.assign(document.createElement('p'), { textContent: t.detail }));
    if (t.useCase) {
      const u = document.createElement('p');
      u.className = 'use';
      u.textContent = t.useCase;
      detail.append(u);
    }
    const inHarbor = document.createElement('p');
    inHarbor.className = 'harbor';
    inHarbor.textContent = `In the harbor: ${t.inHarbor}`;
    detail.append(inHarbor);
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
    // Name matches first (Kubernetes or harbor words), then entries whose concept mentions the query.
    const exact = q ? ORDERED.filter((t) => [...t.naval, ...t.k8s].some((s) => s.toLowerCase() === q)) : [];
    const byName = ORDERED.filter((t) => !q || (!exact.includes(t) && [...t.naval, ...t.k8s].some((s) => s.toLowerCase().includes(q))));
    const byText = q ? ORDERED.filter((t) => !exact.includes(t) && !byName.includes(t) && t.concept.toLowerCase().includes(q)) : [];
    const hits = [...exact, ...byName, ...byText];
    list.replaceChildren(...hits.map((t) => {
      const li = document.createElement('li');
      li.dataset['id'] = t.id;
      li.textContent = titleOf(t);
      if (isHarborOnly(t)) li.classList.add('harbor-only');
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
