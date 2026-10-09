import type { MapApi } from '../hud/minimap';
import type { Placement, TourStep } from './engine';

export interface BubbleHandlers {
  onNext(): void;
  onBack(): void;
  onSkip(): void;
  /** Hint requested for the current step (counts against stars). */
  onHint?(): void;
}

/** A step with an optional hint the learner can ask for. */
export interface HintedStep extends TourStep {
  hint?: string;
}

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`bubble: missing ${sel}`);
  return el;
};

/**
 * The harbor master's speech bubble and spotlight. Shared by the welcome
 * tour and the academy levels; it renders whatever step it is given and
 * reports button presses. The caller owns the step engine and the timer.
 */
export class BubbleUI {
  private readonly root: HTMLElement;
  private readonly spot: HTMLElement;
  private readonly bubble: HTMLElement;
  private step?: HintedStep;
  private hintShown = false;

  constructor(private readonly map: MapApi, private readonly handlers: BubbleHandlers, private readonly skipLabel = 'Skip tour') {
    this.root = $('#tour');
    this.spot = $('.spot', this.root);
    this.bubble = $('.bubble', this.root);
    this.root.hidden = false;
    $('[data-tour=next]', this.root).onclick = () => handlers.onNext();
    $('[data-tour=back]', this.root).onclick = () => handlers.onBack();
    $('[data-tour=skip]', this.root).onclick = () => handlers.onSkip();
    $('[data-tour=skip]', this.root).textContent = skipLabel;
    $('[data-tour=hint]', this.root).onclick = () => this.revealHint();
  }

  show(step: HintedStep, i: number, n: number): void {
    this.step = step;
    this.hintShown = false;
    $('.title', this.bubble).textContent = step.title;
    $('.text', this.bubble).textContent = step.text;
    const cta = $('.cta', this.bubble);
    cta.hidden = !step.cta;
    cta.textContent = step.cta ? `👉 ${step.cta}` : '';
    const hintBtn = $<HTMLButtonElement>('[data-tour=hint]', this.root);
    hintBtn.hidden = !step.hint;
    hintBtn.disabled = false;
    $('.hint', this.bubble).hidden = true;
    $('.dots', this.bubble).replaceChildren(...Array.from({ length: n }, (_, k) => Object.assign(document.createElement('span'), { className: k === i ? 'dot on' : 'dot' })));
    $<HTMLButtonElement>('[data-tour=back]', this.root).disabled = i === 0;
    $('[data-tour=next]', this.root).textContent = i === n - 1 ? 'Finish' : step.waitFor ? 'Skip step' : 'Next';
    if (step.anchor?.kind === 'map') this.map.focusKey(step.anchor.key);
    this.position();
  }

  private revealHint(): void {
    if (!this.step?.hint || this.hintShown) return;
    this.hintShown = true;
    const h = $('.hint', this.bubble);
    h.textContent = `💡 ${this.step.hint}`;
    h.hidden = false;
    $<HTMLButtonElement>('[data-tour=hint]', this.root).disabled = true;
    this.handlers.onHint?.();
    this.position();
  }

  /** Spotlight and bubble follow the anchor (map anchors move with the camera). */
  position(): void {
    const step = this.step;
    if (!step) return;
    let rect: DOMRect | undefined;
    if (step.anchor?.kind === 'dom') rect = document.querySelector(step.anchor.selector)?.getBoundingClientRect() ?? undefined;
    else if (step.anchor?.kind === 'map') {
      const r = this.map.screenRectOf(step.anchor.key);
      if (r) rect = new DOMRect(r.x, r.y, r.width, r.height);
    }
    const pad = 10;
    if (rect && rect.width > 0) {
      this.spot.hidden = false;
      this.spot.style.left = `${rect.left - pad}px`;
      this.spot.style.top = `${rect.top - pad}px`;
      this.spot.style.width = `${rect.width + 2 * pad}px`;
      this.spot.style.height = `${rect.height + 2 * pad}px`;
    } else {
      this.spot.hidden = true;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let place: Placement = step.anchor && 'placement' in step.anchor && step.anchor.placement ? step.anchor.placement : 'bottom';
    // Beside a wide anchor (a form), flip to the roomier side and, if the
    // bubble still does not fit, narrow it rather than cover the anchor.
    this.bubble.style.maxWidth = '';
    if (rect && rect.width > 0 && (place === 'left' || place === 'right')) {
      const roomLeft = rect.left - 30;
      const roomRight = vw - rect.right - 30;
      const want = this.bubble.offsetWidth || 440;
      if ((place === 'left' ? roomLeft : roomRight) < want) place = roomLeft >= roomRight ? 'left' : 'right';
      const room = place === 'left' ? roomLeft : roomRight;
      if (room < want) this.bubble.style.maxWidth = `${Math.max(300, room)}px`;
    }
    const bw = this.bubble.offsetWidth || 440;
    const bh = this.bubble.offsetHeight || 180;
    let x = vw / 2 - bw / 2;
    let y = vh / 2 - bh / 2;
    if (rect && rect.width > 0) {
      const gap = 18;
      if (place === 'bottom') { x = rect.left + rect.width / 2 - bw / 2; y = rect.bottom + gap; }
      if (place === 'top') { x = rect.left + rect.width / 2 - bw / 2; y = rect.top - gap - bh; }
      if (place === 'left') { x = rect.left - gap - bw; y = rect.top + rect.height / 2 - bh / 2; }
      if (place === 'right') { x = rect.right + gap; y = rect.top + rect.height / 2 - bh / 2; }
    }
    x = Math.max(12, Math.min(vw - bw - 12, x));
    y = Math.max(12, Math.min(vh - bh - 12, y));
    // Never cover an open form or panel: step beside it, narrowing if needed.
    const panel = document.querySelector<HTMLElement>('.overlay:not([hidden]) .panel, .overlay:not([hidden]) .drawer');
    const pr = panel?.getBoundingClientRect();
    const anchorInPanel = step.anchor?.kind === 'dom' && !!panel?.contains(document.querySelector(step.anchor.selector));
    // A panel over the map hides what the spotlight pointed at; do not paint over the panel.
    if (pr && pr.width > 0 && !anchorInPanel) this.spot.hidden = true;
    if (pr && pr.width > 0 && x < pr.right && x + bw > pr.left && y < pr.bottom && y + bh > pr.top && !anchorInPanel) {
      const roomLeft = pr.left - 30;
      const roomRight = vw - pr.right - 30;
      const side: Placement = roomLeft >= roomRight ? 'left' : 'right';
      const room = Math.max(roomLeft, roomRight);
      if (room < bw) this.bubble.style.maxWidth = `${Math.max(260, room)}px`;
      const w = Math.min(bw, Math.max(260, room));
      x = side === 'left' ? Math.max(12, pr.left - 18 - w) : Math.min(vw - w - 12, pr.right + 18);
      y = Math.max(12, Math.min(vh - bh - 12, pr.top + pr.height / 2 - bh / 2));
      place = side;
    }
    // Nor over the selection card: its buttons are usually the next thing to press.
    const card = document.querySelector<HTMLElement>('#hud .selection:not([hidden])');
    const cr = card?.getBoundingClientRect();
    if (cr && cr.width > 0 && x < cr.right && x + bw > cr.left && y < cr.bottom && y + bh > cr.top && !(step.anchor?.kind === 'dom' && card?.contains(document.querySelector(step.anchor.selector)))) {
      y = Math.max(12, cr.top - 18 - bh);
    }
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${y}px`;
    this.bubble.dataset['place'] = place;
  }

  destroy(): void {
    this.root.hidden = true;
  }
}
