import { createService, type CreateServiceRequest } from '../api/client';
import { eva, store } from '../app';
import { serviceYaml } from '../levels/manifest';
import { nsOptions, openOverlay } from './overlay';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`lighthouse form: missing ${sel}`);
  return el;
};

/** "app=a,tier=b" into labels; empty strings are dropped. */
export function parseLabels(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(',')) {
    const [k, v] = part.split('=').map((x) => x.trim());
    if (k && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

/** Light a lighthouse: a Service whose selector picks a fleet's ships. */
export function openLighthouseForm(opts: { defaultNamespace?: string } = {}): void {
  const root = $<HTMLDivElement>(document, '#lighthouse-form');
  const form = $<HTMLFormElement>(root, 'form');
  const nsSel = $<HTMLSelectElement>(form, 'select[name=ns]');
  const fleetSel = $<HTMLSelectElement>(form, 'select[name=fleet]');
  const custom = $<HTMLLabelElement>(form, 'label.custom');
  const err = $<HTMLParagraphElement>(form, '.err');
  const submit = $<HTMLButtonElement>(form, 'button[type=submit]');
  const close = openOverlay('lighthouse-form');

  const names = nsOptions(store);
  nsSel.replaceChildren(...names.map((ns) => Object.assign(document.createElement('option'), { value: ns, textContent: ns })));
  const fillFleets = (): void => {
    const ns = nsSel.value;
    const fleets = [
      ...[...store.deployments.values()].filter((d) => d.ns === ns).map((d) => ({ value: d.name, text: `${d.name} (shipyard)` })),
      ...[...store.workloads.values()].filter((w) => w.ns === ns && w.kind !== 'Job').map((w) => ({ value: w.name, text: `${w.name} (${w.kind === 'StatefulSet' ? 'tanker terminal' : 'tug company'})` })),
    ].sort((a, b) => a.value.localeCompare(b.value));
    fleetSel.replaceChildren(
      ...fleets.map((f) => Object.assign(document.createElement('option'), { value: f.value, textContent: f.text })),
      Object.assign(document.createElement('option'), { value: '', textContent: 'custom labels…' }),
    );
    custom.hidden = fleetSel.value !== '';
    renderManifest();
  };
  const selector = (): Record<string, string> => (fleetSel.value ? { app: fleetSel.value } : parseLabels(String(new FormData(form).get('labels') ?? '')));
  const request = (): CreateServiceRequest => {
    const data = new FormData(form);
    const str = (k: string): string => String(data.get(k) ?? '').trim();
    const req: CreateServiceRequest = { ns: str('ns'), name: str('name') || (fleetSel.value || 'my-lighthouse'), selector: selector(), port: Number(str('port') || 80), type: str('type') || 'ClusterIP' };
    if (str('targetPort')) req.targetPort = Number(str('targetPort'));
    return req;
  };
  const renderManifest = (): void => {
    $<HTMLPreElement>(form, 'details.manifest pre').textContent = serviceYaml(request());
  };
  nsSel.onchange = fillFleets;
  fleetSel.onchange = () => { custom.hidden = fleetSel.value !== ''; renderManifest(); };
  form.oninput = renderManifest;
  form.reset();
  if (opts.defaultNamespace && names.includes(opts.defaultNamespace)) nsSel.value = opts.defaultNamespace;
  else if (names.includes('default')) nsSel.value = 'default';
  fillFleets();
  err.hidden = true;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const req = request();
    submit.disabled = true;
    err.hidden = true;
    try {
      if (Object.keys(req.selector).length === 0) throw new Error('pick a fleet or give at least one label');
      await createService(req);
      eva.emit(`LIGHTHOUSE LIT: ${req.name}`);
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
