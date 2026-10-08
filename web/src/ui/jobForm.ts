import { createJob, type CreateJobRequest } from '../api/client';
import { eva, store } from '../app';
import { shellSplit } from '../game/shell';
import { nsOptions, openOverlay } from './overlay';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`fleet form: missing ${sel}`);
  return el;
};

/** Send out a fishing fleet: a Job. Boats appear at the quays and come home when the catch is landed. */
export function openJobForm(): void {
  const root = $<HTMLDivElement>(document, '#job-form');
  const form = $<HTMLFormElement>(root, 'form');
  const nsSel = $<HTMLSelectElement>(form, 'select[name=ns]');
  const err = $<HTMLParagraphElement>(form, '.err');
  const submit = $<HTMLButtonElement>(form, 'button[type=submit]');
  const close = openOverlay('job-form');

  const names = nsOptions(store);
  nsSel.replaceChildren(...names.map((ns) => Object.assign(document.createElement('option'), { value: ns, textContent: ns })));
  form.reset();
  if (names.includes('default')) nsSel.value = 'default';
  err.hidden = true;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const str = (k: string): string => String(data.get(k) ?? '').trim();
    const num = (k: string): number | undefined => (str(k) === '' ? undefined : Number(str(k)));
    submit.disabled = true;
    err.hidden = true;
    try {
      const req: CreateJobRequest = { ns: str('ns'), name: str('name'), image: str('image') };
      const command = shellSplit(str('command'));
      if (command.length) req.command = command;
      const completions = num('completions');
      if (completions !== undefined) req.completions = completions;
      const parallelism = num('parallelism');
      if (parallelism !== undefined) req.parallelism = parallelism;
      const backoff = num('backoff');
      if (backoff !== undefined) req.backoffLimit = backoff;
      const ttl = num('ttl');
      if (ttl !== undefined) req.ttlSeconds = ttl;
      req.restartPolicy = str('restart') === 'OnFailure' ? 'OnFailure' : 'Never';
      if (str('cpu')) req.cpuRequest = str('cpu');
      if (str('mem')) req.memRequest = str('mem');
      await createJob(req);
      eva.emit(`FLEET SAILED: ${req.name}`);
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
