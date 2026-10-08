import type { CreateDeploymentRequest, CreateStatefulSetRequest, MapPos } from '../api/client';
import { modal } from '../app';
import { deploymentYaml } from '../levels/manifest';

export type BuildKind = 'Deployment' | 'StatefulSet';

export interface BuildFormOptions {
  kind: BuildKind;
  namespaces: string[];
  defaultNamespace?: string;
  mapPos?: MapPos;
  /** Resolve to close the form; reject with an Error to show its message. */
  onSubmit: (req: CreateDeploymentRequest | CreateStatefulSetRequest) => Promise<void>;
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
  const heading = $<HTMLElement>(form, 'h2 .kind');
  const storageRow = $<HTMLDivElement>(form, '.storage');

  nsSel.replaceChildren(...opts.namespaces.map((ns) => Object.assign(document.createElement('option'), { value: ns, textContent: ns })));
  if (opts.defaultNamespace) nsSel.value = opts.defaultNamespace;
  where.textContent = opts.mapPos ? `site ${opts.mapPos.x},${opts.mapPos.y}` : 'auto-placed';
  heading.textContent = opts.kind === 'StatefulSet' ? 'TANKER TERMINAL' : 'SHIPYARD';
  storageRow.hidden = opts.kind !== 'StatefulSet';
  err.hidden = true;
  form.reset();
  if (opts.defaultNamespace) nsSel.value = opts.defaultNamespace;
  // Ship's manifest: the YAML the fields become, kept in step as they change.
  const manifest = $<HTMLDetailsElement>(form, 'details.manifest');
  manifest.hidden = opts.kind !== 'Deployment';
  const renderManifest = (): void => {
    if (opts.kind !== 'Deployment') return;
    const data = new FormData(form);
    const str = (k: string): string => String(data.get(k) ?? '').trim();
    const req: CreateDeploymentRequest = { ns: str('ns'), name: str('name') || 'my-ship', image: str('image'), replicas: Number(str('replicas') || 1) };
    if (str('port')) req.port = Number(str('port'));
    if (str('cpu')) req.cpuRequest = str('cpu');
    if (str('mem')) req.memRequest = str('mem');
    $<HTMLPreElement>(manifest, 'pre').textContent = deploymentYaml(req);
  };
  form.oninput = renderManifest;
  renderManifest();

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
    const req: CreateDeploymentRequest | CreateStatefulSetRequest = {
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
    if (opts.kind === 'StatefulSet') {
      const sts = req as CreateStatefulSetRequest;
      if (str('storage')) sts.storage = str('storage');
      if (str('mount')) sts.mountPath = str('mount');
      if (str('storageClass')) sts.storageClass = str('storageClass');
    }
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
