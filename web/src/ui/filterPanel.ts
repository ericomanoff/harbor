import { settings, store } from '../app';
import { isSystemNamespace } from '../layout/colors';
import { openOverlay } from './overlay';

/** "F" filter: tick the namespaces to show on the map. */
export function openFilter(): void {
  const root = document.getElementById('filter')!;
  const list = root.querySelector<HTMLDivElement>('.list')!;
  const sys = root.querySelector<HTMLInputElement>('input[name=system]')!;
  const close = openOverlay('filter');

  const names = [...store.namespaces.keys()].sort((a, b) => Number(isSystemNamespace(a)) - Number(isSystemNamespace(b)) || a.localeCompare(b));
  list.replaceChildren(...names.map((ns) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !settings.hiddenNamespaces.has(ns);
    box.onchange = () => {
      if (box.checked) settings.hiddenNamespaces.delete(ns);
      else settings.hiddenNamespaces.add(ns);
      settings.changed.emit();
    };
    label.append(box, ` ${ns}${isSystemNamespace(ns) ? '  (system)' : ''}`);
    return label;
  }));
  sys.checked = settings.showSystemNamespaces;
  sys.onchange = () => {
    settings.showSystemNamespaces = sys.checked;
    settings.changed.emit();
  };
  root.querySelector<HTMLButtonElement>('button[data-all]')!.onclick = () => {
    settings.hiddenNamespaces.clear();
    settings.changed.emit();
    list.querySelectorAll('input').forEach((i) => { i.checked = true; });
  };
  root.querySelector<HTMLButtonElement>('button[data-close]')!.onclick = close;
}
