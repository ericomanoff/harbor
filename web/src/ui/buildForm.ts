import { orders as ordersApi, type CreateDeploymentRequest, type CreateStatefulSetRequest, type MapPos, type OrdersRef } from '../api/client';
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
  $<HTMLDivElement>(form, '.lookouts').hidden = opts.kind !== 'Deployment';
  $<HTMLDivElement>(form, '.caps').hidden = opts.kind !== 'Deployment';
  const ordersLabel = $<HTMLLabelElement>(form, 'label.orders');
  const ordersSel = $<HTMLSelectElement>(form, 'select[name=orders]');
  ordersLabel.hidden = opts.kind !== 'Deployment';
  // Sealed orders of the chosen namespace, "Kind/name" each; a Secret never shows its values.
  const fillOrders = async (): Promise<void> => {
    if (opts.kind !== 'Deployment') return;
    const ns = nsSel.value;
    let list: { kind: string; name: string }[] = [];
    try {
      list = await ordersApi.list(ns);
    } catch {
      list = [];
    }
    if (nsSel.value !== ns) return;
    ordersSel.replaceChildren(...list.map((o) => Object.assign(document.createElement('option'), { value: `${o.kind}/${o.name}`, textContent: `${o.name} (${o.kind === 'Secret' ? 'sealed envelope' : 'chart locker'})` })));
    ordersSel.disabled = list.length === 0;
    if (list.length === 0) ordersSel.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'none in this fleet yet', disabled: true }));
  };
  const chosenOrders = (): OrdersRef[] => Array.from(ordersSel.selectedOptions).filter((o) => o.value).map((o) => ({ kind: o.value.split('/')[0] as OrdersRef['kind'], name: o.value.split('/').slice(1).join('/') }));
  nsSel.onchange = () => void fillOrders();
  void fillOrders();
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
    if (str('readiness')) req.readinessPath = str('readiness');
    if (str('liveness')) req.livenessPath = str('liveness');
    if (str('cpuLimit')) req.cpuLimit = str('cpuLimit');
    if (str('memLimit')) req.memLimit = str('memLimit');
    const chosen = chosenOrders();
    if (chosen.length) req.orders = chosen;
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
    if (opts.kind === 'Deployment') {
      const dep = req as CreateDeploymentRequest;
      if (str('readiness')) dep.readinessPath = str('readiness');
      if (str('liveness')) dep.livenessPath = str('liveness');
      if (str('cpuLimit')) dep.cpuLimit = str('cpuLimit');
      if (str('memLimit')) dep.memLimit = str('memLimit');
      const chosen = chosenOrders();
      if (chosen.length) dep.orders = chosen;
    }
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
