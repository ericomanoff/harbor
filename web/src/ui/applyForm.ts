import { applyManifest, type ApplyResult } from '../api/client';
import { eva } from '../app';
import { openOverlay } from './overlay';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`apply form: missing ${sel}`);
  return el;
};

export const EXAMPLE_MANIFEST = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: courier
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: courier
  template:
    metadata:
      labels:
        app: courier
    spec:
      containers:
        - name: courier
          image: nginx:1.27-alpine
`;

/**
 * Apply a manifest: paste YAML, preview what would change (a dry run),
 * apply. The same manifest applied twice reports "unchanged".
 */
export function openApplyForm(opts: { manifest?: string } = {}): void {
  const root = $<HTMLDivElement>(document, '#apply-form');
  const form = $<HTMLFormElement>(root, 'form');
  const text = $<HTMLTextAreaElement>(form, 'textarea[name=manifest]');
  const out = $<HTMLDivElement>(form, '.results');
  const err = $<HTMLParagraphElement>(form, '.err');
  const submit = $<HTMLButtonElement>(form, 'button[type=submit]');
  const preview = $<HTMLButtonElement>(form, 'button[data-preview]');
  const close = openOverlay('apply-form');
  if (opts.manifest !== undefined) text.value = opts.manifest;
  else if (!text.value.trim()) text.value = EXAMPLE_MANIFEST;
  err.hidden = true;
  out.replaceChildren();

  const render = (r: ApplyResult, dry: boolean): void => {
    out.replaceChildren(...r.results.map((it) => {
      const box = document.createElement('div');
      box.className = `apply-item ${it.action}`;
      const verb = dry ? { created: 'would be created', configured: 'would change', unchanged: 'unchanged' }[it.action] : { created: 'created', configured: 'configured', unchanged: 'unchanged' }[it.action];
      box.append(Object.assign(document.createElement('b'), { textContent: `${it.kind} ${it.ns ? `${it.ns}/` : ''}${it.name}: ${verb}` }));
      if (it.diff) box.append(Object.assign(document.createElement('pre'), { className: 'diff', textContent: it.diff }));
      return box;
    }));
  };
  const run = async (dry: boolean): Promise<void> => {
    err.hidden = true;
    submit.disabled = preview.disabled = true;
    try {
      const r = await applyManifest(text.value, dry);
      render(r, dry);
      if (!dry) {
        const changed = r.results.filter((x) => x.action !== 'unchanged').length;
        eva.emit(changed ? `MANIFEST APPLIED: ${changed} object${changed > 1 ? 's' : ''} ${r.results.length > changed ? 'changed, the rest unchanged' : 'changed'}` : 'MANIFEST APPLIED: nothing changed (already as declared)');
      }
    } catch (e) {
      err.textContent = `UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`;
      err.hidden = false;
    } finally {
      submit.disabled = preview.disabled = false;
    }
  };
  preview.onclick = () => void run(true);
  form.onsubmit = (ev) => { ev.preventDefault(); void run(false); };
  $<HTMLButtonElement>(form, 'button[data-cancel]').onclick = close;
  text.focus();
}
