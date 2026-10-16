import { patchDeploymentLabels, patchPodLabels, patchServiceSelector, type LabelPatch } from '../api/client';
import { eva } from '../app';
import { openOverlay } from './overlay';
import { parseLabels } from './lighthouseForm';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`ensign form: missing ${sel}`);
  return el;
};

/** From the labels as they are and as edited, the patch that gets there. */
export function labelPatch(before: Record<string, string>, after: Record<string, string>): LabelPatch {
  const set: Record<string, string> = {};
  const remove: string[] = [];
  for (const [k, v] of Object.entries(after)) if (before[k] !== v) set[k] = v;
  for (const k of Object.keys(before)) if (!(k in after)) remove.push(k);
  return { ...(Object.keys(set).length ? { set } : {}), ...(remove.length ? { remove } : {}) };
}

export interface EnsignTarget {
  /** A Service target edits the selector (which ensigns the beam reaches) rather than labels. */
  kind: 'Pod' | 'Deployment' | 'Service';
  ns: string;
  name: string;
  labels: Record<string, string>;
  /** Labels that cannot change (a Deployment's selector). */
  locked?: string[];
}

/** Change ensign: edit a ship's labels, or the labels a shipyard paints on new ships. */
export function openEnsignForm(t: EnsignTarget): void {
  const root = $<HTMLDivElement>(document, '#ensign-form');
  const form = $<HTMLFormElement>(root, 'form');
  const input = $<HTMLInputElement>(form, 'input[name=labels]');
  const err = $<HTMLParagraphElement>(form, '.err');
  const submit = $<HTMLButtonElement>(form, 'button[type=submit]');
  const close = openOverlay('ensign-form');
  $<HTMLElement>(form, 'h2 .where').textContent = t.kind === 'Pod' ? `ship ${t.name}` : t.kind === 'Service' ? `lighthouse ${t.name}: which ensigns the beam reaches` : `shipyard ${t.name}: labels on new ships`;
  $<HTMLElement>(form, 'h2 .title-word').textContent = t.kind === 'Service' ? 'RE-AIM THE BEAM' : 'CHANGE ENSIGN';
  $<HTMLButtonElement>(form, 'button[type=submit]').textContent = t.kind === 'Service' ? 'RE-AIM' : 'HOIST';
  $<HTMLElement>(form, '.locked').textContent = t.locked?.length ? `Selector labels stay: ${t.locked.join(', ')}` : '';
  input.value = Object.entries(t.labels).map(([k, v]) => `${k}=${v}`).join(', ');
  err.hidden = true;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const after = parseLabels(input.value);
    const patch = labelPatch(t.labels, after);
    if (!patch.set && !patch.remove) {
      err.textContent = 'Nothing changed.';
      err.hidden = false;
      return;
    }
    submit.disabled = true;
    err.hidden = true;
    try {
      if (t.kind === 'Pod') await patchPodLabels(t.ns, t.name, patch);
      else if (t.kind === 'Service') await patchServiceSelector(t.ns, t.name, after);
      else await patchDeploymentLabels(t.ns, t.name, patch);
      eva.emit(t.kind === 'Service' ? `BEAM RE-AIMED: ${t.name}` : `ENSIGN CHANGED: ${t.name}`);
      close();
    } catch (e) {
      err.textContent = `UNABLE TO COMPLY: ${e instanceof Error ? e.message : String(e)}`;
      err.hidden = false;
    } finally {
      submit.disabled = false;
    }
  };
  $<HTMLButtonElement>(form, 'button[data-cancel]').onclick = close;
  input.focus();
}
