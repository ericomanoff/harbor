import { createIngress } from '../api/client';
import { eva, store } from '../app';
import { nsOptions, openOverlay } from './overlay';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`gate form: missing ${sel}`);
  return el;
};

/** Open a gate: an Ingress with one host/path rule to a lighthouse. */
export function openGateForm(): void {
  const root = $<HTMLDivElement>(document, '#gate-form');
  const form = $<HTMLFormElement>(root, 'form');
  const nsSel = $<HTMLSelectElement>(form, 'select[name=ns]');
  const svcSel = $<HTMLSelectElement>(form, 'select[name=service]');
  const portSel = $<HTMLSelectElement>(form, 'select[name=port]');
  const portText = $<HTMLInputElement>(form, 'input[name=portText]');
  const err = $<HTMLParagraphElement>(form, '.err');
  const submit = $<HTMLButtonElement>(form, 'button[type=submit]');
  const close = openOverlay('gate-form');

  const names = nsOptions(store);
  nsSel.replaceChildren(...names.map((ns) => Object.assign(document.createElement('option'), { value: ns, textContent: ns })));
  const fillServices = (): void => {
    const svcs = [...store.services.values()].filter((s) => s.ns === nsSel.value).sort((a, b) => a.name.localeCompare(b.name));
    svcSel.replaceChildren(...svcs.map((s) => Object.assign(document.createElement('option'), { value: s.name, textContent: `${s.name} (${s.type})` })));
    svcSel.disabled = svcs.length === 0;
    fillPorts();
  };
  const fillPorts = (): void => {
    const svc = store.services.get(`${nsSel.value}/${svcSel.value}`);
    const ports = svc?.ports ?? [];
    portSel.replaceChildren(...ports.map((p) => Object.assign(document.createElement('option'), { value: p.name || String(p.port), textContent: `${p.port}${p.name ? ` (${p.name})` : ''} → ${p.targetPort}/${p.protocol}` })), Object.assign(document.createElement('option'), { value: '', textContent: 'other…' }));
    portSel.hidden = ports.length === 0;
    portText.hidden = ports.length > 0;
  };
  nsSel.onchange = fillServices;
  svcSel.onchange = fillPorts;
  portSel.onchange = () => { portText.hidden = portSel.value !== ''; };
  form.reset();
  if (names.includes('default')) nsSel.value = 'default';
  fillServices();
  err.hidden = true;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const str = (k: string): string => String(data.get(k) ?? '').trim();
    const port = portSel.hidden || portSel.value === '' ? str('portText') : portSel.value;
    submit.disabled = true;
    err.hidden = true;
    try {
      await createIngress({
        ns: str('ns'), name: str('name'), service: str('service'), port,
        host: str('host') || undefined, path: str('path') || undefined, class: str('class') || undefined,
        tls: data.get('tls') === 'on', tlsSecret: str('tlsSecret') || undefined,
      });
      eva.emit(`GATE OPENED: ${str('name')}`);
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
