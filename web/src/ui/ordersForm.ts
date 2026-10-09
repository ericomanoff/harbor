import { orders as ordersApi, type CreateOrdersRequest } from '../api/client';
import { eva, store } from '../app';
import { ordersYaml } from '../levels/manifest';
import { nsOptions, openOverlay } from './overlay';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`orders form: missing ${sel}`);
  return el;
};

/** "KEY=value" lines into data; blank lines and lines without "=" are skipped. */
export function parseOrders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (!line || eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Seal orders: write a ConfigMap (chart locker) or a Secret (sealed envelope). */
export function openOrdersForm(opts: { defaultNamespace?: string; kind?: 'ConfigMap' | 'Secret' } = {}): void {
  const root = $<HTMLDivElement>(document, '#orders-form');
  const form = $<HTMLFormElement>(root, 'form');
  const nsSel = $<HTMLSelectElement>(form, 'select[name=ns]');
  const kindSel = $<HTMLSelectElement>(form, 'select[name=kind]');
  const err = $<HTMLParagraphElement>(form, '.err');
  const submit = $<HTMLButtonElement>(form, 'button[type=submit]');
  const close = openOverlay('orders-form');
  const names = nsOptions(store);
  nsSel.replaceChildren(...names.map((ns) => Object.assign(document.createElement('option'), { value: ns, textContent: ns })));
  form.reset();
  if (opts.defaultNamespace && names.includes(opts.defaultNamespace)) nsSel.value = opts.defaultNamespace;
  else if (names.includes('default')) nsSel.value = 'default';
  if (opts.kind) kindSel.value = opts.kind;
  err.hidden = true;
  const request = (): CreateOrdersRequest => {
    const data = new FormData(form);
    const str = (k: string): string => String(data.get(k) ?? '').trim();
    return { ns: str('ns'), name: str('name') || 'my-orders', kind: str('kind') === 'Secret' ? 'Secret' : 'ConfigMap', data: parseOrders(String(data.get('data') ?? '')) };
  };
  const renderManifest = (): void => {
    $<HTMLPreElement>(form, 'details.manifest pre').textContent = ordersYaml(request());
  };
  form.oninput = renderManifest;
  renderManifest();
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const req = request();
    submit.disabled = true;
    err.hidden = true;
    try {
      if (Object.keys(req.data).length === 0) throw new Error('write at least one KEY=value line');
      await ordersApi.create(req);
      eva.emit(`ORDERS SEALED: ${req.name}`);
      close();
    } catch (e) {
      err.textContent = `UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`;
      err.hidden = false;
    } finally {
      submit.disabled = false;
    }
  };
  $<HTMLButtonElement>(form, 'button[data-cancel]').onclick = close;
  $<HTMLInputElement>(form, 'input[name=name]').focus();
}
