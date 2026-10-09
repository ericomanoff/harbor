import { createNamespace } from '../api/client';
import { eva } from '../app';
import { openOverlay } from './overlay';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`fleet form: missing ${sel}`);
  return el;
};

/** Found a fleet: create a Namespace. */
export function openFleetForm(): void {
  const root = $<HTMLDivElement>(document, '#fleet-form');
  const form = $<HTMLFormElement>(root, 'form');
  const err = $<HTMLParagraphElement>(form, '.err');
  const submit = $<HTMLButtonElement>(form, 'button[type=submit]');
  const close = openOverlay('fleet-form');
  form.reset();
  err.hidden = true;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const name = String(new FormData(form).get('name') ?? '').trim();
    submit.disabled = true;
    err.hidden = true;
    try {
      await createNamespace(name);
      eva.emit(`FLEET FOUNDED: ${name}`);
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
