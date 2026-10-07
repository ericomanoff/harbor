import type { CreateDeploymentRequest, MapPos } from '../api/client';
import { modal } from '../app';

export interface BuildFormOptions {
  namespaces: string[];
  defaultNamespace?: string;
  mapPos?: MapPos;
  /** Resolve to close the form; reject with an Error to show its message. */
  onSubmit: (req: CreateDeploymentRequest) => Promise<void>;
}

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`build form: missing ${sel}`);
  return el;
};

/** Opens the War Factory build form (an HTML overlay styled like the sidebar). */
export function openBuildForm(opts: BuildFormOptions): void {
  const root = $<HTMLDivElement>(document, '#build-form');
  const form = $<HTMLFormElement>(root, 'form');
  const nsSel = $<HTMLSelectElement>(form, 'select[name=ns]');
  const err = $<HTMLParagraphElement>(form, '.err');
  const submit = $<HTMLButtonElement>(form, 'button[type=submit]');
  const where = $<HTMLSpanElement>(form, '.where');

  nsSel.replaceChildren(...opts.namespaces.map((ns) => Object.assign(document.createElement('option'), { value: ns, textContent: ns })));
  if (opts.defaultNamespace) nsSel.value = opts.defaultNamespace;
  where.textContent = opts.mapPos ? `site ${opts.mapPos.x},${opts.mapPos.y}` : 'auto-placed';
  err.hidden = true;
  form.reset();
  if (opts.defaultNamespace) nsSel.value = opts.defaultNamespace;

  const close = (): void => {
    root.hidden = true;
    form.onsubmit = null;
    modal.set(false);
  };

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const str = (k: string): string => String(data.get(k) ?? '').trim();
    const num = (k: string): number | undefined => (str(k) === '' ? undefined : Number(str(k)));
    const req: CreateDeploymentRequest = {
      ns: str('ns'),
      name: str('name'),
      image: str('image'),
      replicas: num('replicas') ?? 1,
    };
    const port = num('port');
    if (port !== undefined) req.port = port;
    if (str('cpu')) req.cpuRequest = str('cpu');
    if (str('mem')) req.memRequest = str('mem');
    if (opts.mapPos) req.mapPos = opts.mapPos;
    submit.disabled = true;
    err.hidden = true;
    try {
      await opts.onSubmit(req);
      close();
    } catch (e) {
      err.textContent = `UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`;
      err.hidden = false;
    } finally {
      submit.disabled = false;
    }
  };
  $<HTMLButtonElement>(form, 'button[data-cancel]').onclick = close;
  root.onkeydown = (ev) => {
    if (ev.key === 'Escape') close();
    ev.stopPropagation();
  };

  root.hidden = false;
  modal.set(true);
  $<HTMLInputElement>(form, 'input[name=name]').focus();
}
