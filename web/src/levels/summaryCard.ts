import { openOverlay } from '../ui/overlay';
import type { Level, LevelResult, LevelSummary } from './types';

export interface SummaryActions {
  onReplay(): void;
  onNext?(): void;
  onSelect(): void;
  onLeave(): void;
}

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`summary: missing ${sel}`);
  return el;
};

/** The lesson summary: naval, Kubernetes and DevOps columns, then the manifest and kubectl. */
export function openSummary(level: Level, result: LevelResult, summary: LevelSummary, actions: SummaryActions): () => void {
  const root = $<HTMLDivElement>('#summary');
  $('h2 .lvl', root).textContent = `Level ${level.number}: ${level.title}`;
  $('h2 .where', root).textContent = level.concept;
  $('.stars', root).textContent = '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars);
  $('[data-col=naval]', root).textContent = summary.naval;
  $('[data-col=k8s]', root).textContent = summary.kubernetes;
  $('[data-col=devops]', root).textContent = summary.devops;
  const manifest = $<HTMLElement>('.manifest', root);
  manifest.hidden = !summary.manifest;
  $('pre.yaml', root).textContent = summary.manifest ?? '';
  $('pre.kubectl', root).textContent = summary.kubectl ?? '';
  $<HTMLElement>('.kubectl-row', root).hidden = !summary.kubectl;
  const close = openOverlay('summary');
  const next = $<HTMLButtonElement>('[data-next]', root);
  next.hidden = !actions.onNext;
  next.onclick = () => { close(); actions.onNext?.(); };
  $<HTMLButtonElement>('[data-replay]', root).onclick = () => { close(); actions.onReplay(); };
  $<HTMLButtonElement>('[data-select]', root).onclick = () => { close(); actions.onSelect(); };
  $<HTMLButtonElement>('[data-leave]', root).onclick = () => { close(); actions.onLeave(); };
  return close;
}
