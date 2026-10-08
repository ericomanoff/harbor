import { contexts } from '../api/client';
import { eva } from '../app';
import { openOverlay } from './overlay';

/** Theater select: pick the kubeconfig context the backend should watch. */
export function openMissionSelect(): void {
  const root = document.getElementById('mission')!;
  const list = root.querySelector<HTMLDivElement>('.rows')!;
  const err = root.querySelector<HTMLParagraphElement>('.err')!;
  const close = openOverlay('mission');
  root.querySelector<HTMLButtonElement>('button[data-close]')!.onclick = close;
  err.hidden = true;
  list.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'scanning theaters…' }));

  void contexts.list().then((cl) => {
    list.replaceChildren(...cl.contexts.map((c) => {
      const row = document.createElement('div');
      row.className = 'row';
      const b = document.createElement('b');
      b.textContent = c.name;
      const info = document.createElement('span');
      info.className = 'desc';
      info.textContent = `cluster ${c.cluster}  user ${c.user}${c.namespace ? `  ns ${c.namespace}` : ''}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = c.name === cl.current ? 'ACTIVE' : 'DEPLOY';
      btn.disabled = c.name === cl.current;
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'CONNECTING…';
        try {
          await contexts.select(c.name);
          eva.emit(`THEATER CHANGED: ${c.name}`);
          close();
        } catch (e) {
          err.textContent = `UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`;
          err.hidden = false;
          btn.disabled = false;
          btn.textContent = 'DEPLOY';
        }
      };
      row.append(b, info, btn);
      return row;
    }));
    if (cl.contexts.length === 0) list.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No contexts in kubeconfig.' }));
  }).catch((e: unknown) => {
    err.textContent = `UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`;
    err.hidden = false;
  });
}
