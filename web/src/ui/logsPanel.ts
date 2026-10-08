import { getPodLogs } from '../api/client';
import type { Pod } from '../store/cluster';
import { openOverlay } from './overlay';

const REFRESH_MS = 2000;

/** Unit intel: the tail of a pod's log, refreshed while open. */
export function openLogs(pod: Pod): void {
  const root = document.getElementById('logs')!;
  const title = root.querySelector<HTMLElement>('.where')!;
  const sel = root.querySelector<HTMLSelectElement>('select[name=container]')!;
  const pre = root.querySelector<HTMLPreElement>('pre')!;
  const follow = root.querySelector<HTMLInputElement>('input[name=follow]')!;
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = openOverlay('logs', () => { if (timer) clearInterval(timer); });
  root.querySelector<HTMLButtonElement>('button[data-close]')!.onclick = close;

  title.textContent = `${pod.ns}/${pod.name}`;
  sel.replaceChildren(...pod.containers.map((c) => Object.assign(document.createElement('option'), { value: c, textContent: c })));
  sel.hidden = pod.containers.length < 2;

  const load = async (): Promise<void> => {
    try {
      const text = await getPodLogs(pod.ns, pod.name, 300, sel.value || undefined);
      const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
      pre.textContent = text || '(no output yet)';
      if (atBottom || follow.checked) pre.scrollTop = pre.scrollHeight;
    } catch (e) {
      pre.textContent = `UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
  sel.onchange = () => void load();
  root.querySelector<HTMLButtonElement>('button[data-refresh]')!.onclick = () => void load();
  pre.textContent = 'retrieving…';
  void load();
  timer = setInterval(() => { if (follow.checked) void load(); }, REFRESH_MS);
}
