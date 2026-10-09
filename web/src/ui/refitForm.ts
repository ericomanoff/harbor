import { refitDeployment, type RefitRequest } from '../api/client';
import { eva } from '../app';
import type { Deployment } from '../store/cluster';
import { openOverlay } from './overlay';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`refit form: missing ${sel}`);
  return el;
};

/** The strategic-merge patch a refit sends, with harbor notes. */
export function refitYaml(d: Pick<Deployment, 'name' | 'ns'>, req: RefitRequest): string {
  const lines = ['spec:'];
  if (req.maxUnavailable || req.maxSurge) {
    lines.push('  strategy:', '    type: RollingUpdate', '    rollingUpdate:');
    if (req.maxUnavailable) lines.push(`      maxUnavailable: ${req.maxUnavailable}   # ships that may be missing mid-refit`);
    if (req.maxSurge) lines.push(`      maxSurge: ${req.maxSurge}         # extra ships launched first`);
  }
  lines.push('  template:', '    spec:', '      containers:', `        - name: ${d.name}`, `          image: ${req.image}      # the new hull`);
  return lines.join('\n');
}

/** Refit a shipyard: a rollout to a new image, optionally with a safer strategy. */
export function openRefitForm(d: Deployment): void {
  const root = $<HTMLDivElement>(document, '#refit-form');
  const form = $<HTMLFormElement>(root, 'form');
  const err = $<HTMLParagraphElement>(form, '.err');
  const submit = $<HTMLButtonElement>(form, 'button[type=submit]');
  const close = openOverlay('refit-form');
  $<HTMLSpanElement>(form, 'h2 .where').textContent = `${d.name} · now ${d.image}`;
  form.reset();
  $<HTMLInputElement>(form, 'input[name=image]').value = d.image;
  const request = (): RefitRequest => {
    const data = new FormData(form);
    const str = (k: string): string => String(data.get(k) ?? '').trim();
    const req: RefitRequest = { image: str('image') };
    if (str('maxUnavailable')) req.maxUnavailable = str('maxUnavailable');
    if (str('maxSurge')) req.maxSurge = str('maxSurge');
    return req;
  };
  const render = (): void => {
    $<HTMLPreElement>(form, 'details.manifest pre').textContent = refitYaml(d, request());
  };
  form.oninput = render;
  render();
  err.hidden = true;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    submit.disabled = true;
    err.hidden = true;
    try {
      await refitDeployment(d.ns, d.name, request());
      eva.emit(`REFIT STARTED: ${d.name}`);
      close();
    } catch (e) {
      err.textContent = `UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`;
      err.hidden = false;
    } finally {
      submit.disabled = false;
    }
  };
  $<HTMLButtonElement>(form, 'button[data-cancel]').onclick = close;
  $<HTMLInputElement>(form, 'input[name=image]').focus();
}
