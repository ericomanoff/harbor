import { modal } from '../app';
import type { MapApi } from '../hud/minimap';
import type { TourStep } from './engine';
import { keepClear } from './keepClear';

export interface BubbleHandlers {
  onNext(): void;
  onBack(): void;
  onSkip(): void;
  /** Hint requested for the current step (counts against stars). */
  onHint?(): void;
}

/** A step with an optional hint the learner can ask for, and an optional action button. */
export interface HintedStep extends TourStep {
  hint?: string;
  /** A button in the bubble (campaign checks and forms); the result line shows what it did. */
  action?: { label: string; run: () => Promise<{ ok: boolean; message: string } | void> };
  /** A prediction to make: pills, one correct; a wrong pick counts like a hint. */
  choices?: { text: string; correct: boolean; explain?: string }[];
  onChoice?: (correct: boolean) => void;
}

/** Who is talking: Captain Huber runs the expeditions, the harbor master runs the welcome tour. */
export interface Speaker {
  name: string;
  face: string;
}
export const CAPTAIN_HUBER: Speaker = { name: 'Captain Huber', face: '🏴‍☠️' };
export const HARBOR_MASTER: Speaker = { name: 'Harbor master', face: '🧑‍✈️' };

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`bubble: missing ${sel}`);
  return el;
};

/**
 * The speaker's dock: a speech bubble and portrait fixed at the bottom
 * right, off the gameplay, like an adventure game's talking character.
 * The bubble never moves; the spotlight and an arrow point at the step's
 * target instead. The caller owns the step engine and the timer.
 */
export class BubbleUI {
  private readonly root: HTMLElement;
  private readonly spot: HTMLElement;
  private readonly arrow: SVGSVGElement;
  private readonly dock: HTMLElement;
  private readonly bubble: HTMLElement;
  private step?: HintedStep;
  private hintShown = false;
  private readonly unModal: () => void;
  /** Why the dock is folded: the learner asked, a modal is open, or the selection card needs the room. */
  private readonly folded = { manual: false, modal: false, room: false };
  private shift = 0;

  constructor(private readonly map: MapApi, private readonly handlers: BubbleHandlers, private readonly skipLabel = 'Skip tour', speaker: Speaker = CAPTAIN_HUBER) {
    this.root = $('#captain');
    this.spot = $('.spot', this.root);
    this.arrow = this.root.querySelector('svg.arrow') as SVGSVGElement;
    this.dock = $('.dock', this.root);
    this.bubble = $('.bubble', this.root);
    this.root.hidden = false;
    document.body.classList.add('captain-open');
    this.dock.classList.remove('collapsed');
    $('.portrait .face', this.root).textContent = speaker.face;
    $('.portrait .who', this.root).textContent = speaker.name;
    $('.portrait', this.root).title = speaker.name;
    $('[data-tour=next]', this.root).onclick = () => handlers.onNext();
    $('[data-tour=back]', this.root).onclick = () => handlers.onBack();
    $('[data-tour=skip]', this.root).onclick = () => handlers.onSkip();
    $('[data-tour=skip]', this.root).textContent = skipLabel;
    $('[data-tour=hint]', this.root).onclick = () => this.revealHint();
    $('[data-tour=action]', this.root).onclick = () => void this.runAction();
    const toggle = (): void => { this.folded.manual = !this.folded.manual; this.applyFold(); };
    $('[data-tour=collapse]', this.root).onclick = toggle;
    $('.portrait', this.root).onclick = toggle;
    const onModal = (open: boolean): void => {
      document.body.classList.toggle('modal-open', open);
      this.folded.modal = open;
      this.applyFold();
    };
    onModal(modal.open);
    this.unModal = modal.changed.on(onModal);
  }

  private async runAction(): Promise<void> {
    const step = this.step;
    if (!step?.action) return;
    const btn = $<HTMLButtonElement>('[data-tour=action]', this.root);
    const out = $('.result', this.bubble);
    btn.disabled = true;
    out.hidden = false;
    out.className = 'result busy';
    out.textContent = '…';
    try {
      const r = await step.action.run();
      if (r) {
        out.className = `result ${r.ok ? 'ok' : 'fail'}`;
        out.textContent = `${r.ok ? '✓' : '✗'} ${r.message}`;
      } else {
        out.hidden = true;
      }
    } catch (e) {
      out.className = 'result fail';
      out.textContent = `✗ ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      if (this.step === step) btn.disabled = false;
    }
  }

  private applyFold(): void {
    this.dock.classList.toggle('collapsed', this.folded.manual || this.folded.modal || this.folded.room);
    this.dock.classList.toggle('room', this.folded.room);
  }

  /** Slides the bottom-centre column (toasts, selection card) clear of the bubble, folding the dock when there is no room. */
  private keepCardClear(): void {
    const column = document.querySelector<HTMLElement>('#hud .hud-bottom-center');
    if (!column) return;
    const rect = column.getBoundingClientRect();
    const hasContent = rect.height > 0 && Array.from(column.children).some((c) => !(c as HTMLElement).hidden && c.getBoundingClientRect().height > 0);
    const base = { left: rect.left + this.shift, right: rect.right + this.shift };
    const dockRight = this.dock.getBoundingClientRect().right;
    const fullLeft = dockRight - 94 - 440; // portrait and gap, then the full bubble
    const foldedLeft = dockRight - 280; // the room-fold: no portrait, a narrow bubble
    const left = document.querySelector<HTMLElement>('#hud .hud-bottom-left')?.getBoundingClientRect().right ?? 0;
    const { shift, fold } = hasContent ? keepClear(base, fullLeft, foldedLeft, left, this.folded.room) : { shift: 0, fold: false };
    if (shift !== this.shift) {
      this.shift = shift;
      document.body.style.setProperty('--card-shift', `${shift}px`);
    }
    if (fold !== this.folded.room) {
      this.folded.room = fold;
      this.applyFold();
    }
  }

  show(step: HintedStep, i: number, n: number): void {
    this.step = step;
    this.hintShown = false;
    this.folded.manual = false;
    this.applyFold();
    $('.title', this.bubble).textContent = step.title;
    $('.text', this.bubble).textContent = step.text;
    $('.text', this.bubble).scrollTop = 0;
    const cta = $('.cta', this.bubble);
    cta.hidden = !step.cta;
    cta.textContent = step.cta ? `👉 ${step.cta}` : '';
    const hintBtn = $<HTMLButtonElement>('[data-tour=hint]', this.root);
    hintBtn.hidden = !step.hint;
    hintBtn.disabled = false;
    $('.hint', this.bubble).hidden = true;
    const actBtn = $<HTMLButtonElement>('[data-tour=action]', this.root);
    actBtn.hidden = !step.action;
    actBtn.disabled = false;
    actBtn.textContent = step.action?.label ?? '';
    $('.result', this.bubble).hidden = true;
    const choices = $('.choices', this.bubble);
    choices.replaceChildren(...(step.choices ?? []).map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill secondary';
      b.textContent = c.text;
      b.onclick = () => this.pick(c, choices);
      return b;
    }));
    choices.hidden = !step.choices?.length;
    $('.dots', this.bubble).replaceChildren(...Array.from({ length: n }, (_, k) => Object.assign(document.createElement('span'), { className: k === i ? 'dot on' : 'dot' })));
    $<HTMLButtonElement>('[data-tour=back]', this.root).disabled = i === 0;
    $('[data-tour=next]', this.root).textContent = i === n - 1 ? 'Finish' : step.waitFor ? 'Skip step' : 'Next';
    if (step.anchor?.kind === 'map') this.map.focusKey(step.anchor.key);
    this.position();
  }

  private pick(c: NonNullable<HintedStep['choices']>[number], choices: HTMLElement): void {
    const out = $('.result', this.bubble);
    out.hidden = false;
    out.className = `result ${c.correct ? 'ok' : 'fail'}`;
    out.textContent = `${c.correct ? '✓' : '✗'} ${c.explain ?? (c.correct ? 'Right.' : 'Not quite; try another.')}`;
    if (c.correct) {
      choices.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      this.step?.onChoice?.(true);
    } else {
      this.handlers.onHint?.();
      this.step?.onChoice?.(false);
    }
  }

  private revealHint(): void {
    if (!this.step?.hint || this.hintShown) return;
    this.hintShown = true;
    const h = $('.hint', this.bubble);
    h.textContent = `💡 ${this.step.hint}`;
    h.hidden = false;
    $<HTMLButtonElement>('[data-tour=hint]', this.root).disabled = true;
    this.handlers.onHint?.();
  }

  /** The spotlight and arrow follow the step's target (map targets move with the camera); the dock stays put. */
  position(): void {
    this.keepCardClear();
    const step = this.step;
    if (!step) return;
    let rect: DOMRect | undefined;
    if (step.anchor?.kind === 'dom') rect = document.querySelector(step.anchor.selector)?.getBoundingClientRect() ?? undefined;
    else if (step.anchor?.kind === 'map') {
      const r = this.map.screenRectOf(step.anchor.key);
      if (r) rect = new DOMRect(r.x, r.y, r.width, r.height);
    }
    // A panel over the map hides a map target; a target inside the panel is still pointed at.
    const panel = document.querySelector<HTMLElement>('.overlay:not([hidden]) .panel, .overlay:not([hidden]) .drawer');
    const inPanel = step.anchor?.kind === 'dom' && !!panel?.contains(document.querySelector(step.anchor.selector));
    if (panel && !inPanel && step.anchor?.kind === 'map') rect = undefined;
    const dockRect = this.dock.getBoundingClientRect();
    const onScreen = !!rect && rect.width > 0 && rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight;
    const underDock = !!rect && rect.left < dockRect.right && rect.right > dockRect.left && rect.top < dockRect.bottom && rect.bottom > dockRect.top;
    if (!rect || !onScreen || underDock) {
      this.spot.hidden = true;
      this.arrow.setAttribute('hidden', '');
      return;
    }
    const pad = 10;
    this.spot.hidden = false;
    this.spot.style.left = `${rect.left - pad}px`;
    this.spot.style.top = `${rect.top - pad}px`;
    this.spot.style.width = `${rect.width + 2 * pad}px`;
    this.spot.style.height = `${rect.height + 2 * pad}px`;
    // An arrow from the bubble's edge to the target, stopping short of the spotlight.
    const bx = this.bubble.getBoundingClientRect();
    const sx = rect.left + rect.width / 2 < bx.left ? bx.left : bx.left + bx.width / 2;
    const sy = rect.top + rect.height / 2 < bx.top ? bx.top : bx.top + bx.height / 2;
    const tx = rect.left + rect.width / 2;
    const ty = rect.top + rect.height / 2;
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const stop = Math.max(0, len - Math.max(rect.width, rect.height) / 2 - pad - 6);
    const ex = sx + (dx / len) * stop;
    const ey = sy + (dy / len) * stop;
    if (stop < 40) {
      this.arrow.setAttribute('hidden', '');
      return;
    }
    this.arrow.removeAttribute('hidden');
    const shaft = this.arrow.querySelector('.shaft')!;
    shaft.setAttribute('x1', String(sx));
    shaft.setAttribute('y1', String(sy));
    shaft.setAttribute('x2', String(ex));
    shaft.setAttribute('y2', String(ey));
    const tip = this.arrow.querySelector('.tip')!;
    tip.setAttribute('cx', String(ex));
    tip.setAttribute('cy', String(ey));
  }

  destroy(): void {
    this.root.hidden = true;
    this.unModal();
    document.body.classList.remove('captain-open', 'modal-open');
    document.body.style.removeProperty('--card-shift');
    this.spot.hidden = true;
    this.arrow.setAttribute('hidden', '');
  }
}
