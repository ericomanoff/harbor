import { getPapers, type ObjectPapers } from '../api/client';
import { actorName } from '../game/ledger';
import { openOverlay } from './overlay';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`papers: missing ${sel}`);
  return el;
};

/** Lines of `status` whose key also appears in `spec` with a different value: where the cluster lags the wish. */
export function disagreements(spec: string, status: string): Set<string> {
  const keyOf = (line: string): string | undefined => /^\s*([A-Za-z]+):\s*(\S.*)$/.exec(line)?.[1];
  const valOf = (line: string): string => line.replace(/^[^:]*:\s*/, '');
  const specVals = new Map<string, string>();
  for (const line of spec.split('\n')) {
    const k = keyOf(line);
    if (k && valOf(line)) specVals.set(k, valOf(line));
  }
  const out = new Set<string>();
  for (const line of status.split('\n')) {
    const k = keyOf(line);
    // replicas vs availableReplicas/readyReplicas: compare on the shared stem
    const stem = k?.replace(/^(available|ready|updated|current)/, '').replace(/^Replicas$/, 'replicas');
    const want = (k && specVals.get(k)) ?? (stem && specVals.get(stem));
    if (k && want !== undefined && valOf(line) !== want) out.add(line);
  }
  return out;
}

/**
 * Papers: the object's spec (what you asked for) beside its status (what the
 * cluster reports), live while open, plus who has written to it.
 */
export function openPapers(kind: string, ns: string, name: string): void {
  const root = $<HTMLDivElement>(document, '#papers');
  const title = $<HTMLElement>(root, 'h2 .obj');
  const spec = $<HTMLPreElement>(root, 'pre.spec');
  const status = $<HTMLPreElement>(root, 'pre.status');
  const meta = $<HTMLPreElement>(root, 'pre.meta');
  const managers = $<HTMLElement>(root, '.managers');
  const err = $<HTMLParagraphElement>(root, '.err');
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = openOverlay('papers', () => { if (timer) clearInterval(timer); });
  $<HTMLButtonElement>(root, 'button[data-close]').onclick = close;
  title.textContent = `${kind} ${ns ? `${ns}/` : ''}${name}`;
  err.hidden = true;
  const show = (p: ObjectPapers): void => {
    spec.textContent = p.spec || '(no spec)';
    const bad = disagreements(p.spec, p.status);
    status.replaceChildren(...(p.status || '(no status yet)').split('\n').map((line) => {
      const s = document.createElement('span');
      s.textContent = `${line}\n`;
      if (bad.has(line)) s.className = 'lag';
      return s;
    }));
    meta.textContent = p.metadata;
    managers.textContent = p.managers.length ? `written by: ${p.managers.map((m) => `${actorName(m)} (${m})`).join(', ')}` : 'written by: unknown (no managed fields)';
  };
  const refresh = async (): Promise<void> => {
    try {
      show(await getPapers(kind, ns, name));
      err.hidden = true;
    } catch (e) {
      err.textContent = `UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`;
      err.hidden = false;
      if (timer) clearInterval(timer);
    }
  };
  void refresh();
  timer = setInterval(() => void refresh(), 1500);
}
