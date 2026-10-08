import { selection } from '../app';
import type { MapApi } from '../hud/minimap';
import { TourEngine, type Placement, type TourStep } from './engine';
import { tourSteps } from './steps';
import { enterTraining, leaveTraining } from './training';

const DONE_KEY = 'harbor.tour.v1';
let running: Tour | undefined;

export function tourDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === 'done';
  } catch {
    return true;
  }
}

export function startTour(map: MapApi): void {
  if (running) return;
  running = new Tour(map);
}

/** Auto-start on the first visit unless the URL opts out. */
export function maybeAutoStartTour(map: MapApi): void {
  const params = new URLSearchParams(location.search);
  if (params.has('notour') || params.has('style') || tourDone()) return;
  setTimeout(() => startTour(map), 900);
}

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`tour: missing ${sel}`);
  return el;
};

/** Renders the harbor master's bubbles and the spotlight over the current step. */
class Tour {
  private readonly engine: TourEngine;
  private readonly root: HTMLElement;
  private readonly spot: HTMLElement;
  private readonly bubble: HTMLElement;
  private timer: ReturnType<typeof setInterval>;
  private step?: TourStep;

  constructor(private readonly map: MapApi) {
    enterTraining();
    selection.clear();
    this.root = $('#tour');
    this.spot = $('.spot', this.root);
    this.bubble = $('.bubble', this.root);
    this.root.hidden = false;
    $('[data-tour=next]', this.root).onclick = () => this.engine.next();
    $('[data-tour=back]', this.root).onclick = () => this.engine.back();
    $('[data-tour=skip]', this.root).onclick = () => this.engine.skip();
    this.engine = new TourEngine(tourSteps(), {
      onStep: (s, i, n) => this.show(s, i, n),
      onFinish: () => this.finish(),
    });
    this.timer = setInterval(() => {
      this.engine.tick();
      this.position();
    }, 150);
    this.engine.start();
  }

  private show(step: TourStep, i: number, n: number): void {
    this.step = step;
    $('.title', this.bubble).textContent = step.title;
    $('.text', this.bubble).textContent = step.text;
    const cta = $('.cta', this.bubble);
    cta.hidden = !step.cta;
    cta.textContent = step.cta ? `👉 ${step.cta}` : '';
    $('.dots', this.bubble).replaceChildren(...Array.from({ length: n }, (_, k) => Object.assign(document.createElement('span'), { className: k === i ? 'dot on' : 'dot' })));
    $<HTMLButtonElement>('[data-tour=back]', this.root).disabled = i === 0;
    $('[data-tour=next]', this.root).textContent = i === n - 1 ? 'Finish' : step.waitFor ? 'Skip step' : 'Next';
    if (step.anchor?.kind === 'map') this.map.focusKey(step.anchor.key);
    this.position();
  }

  /** Spotlight and bubble follow the anchor (map anchors move with the camera). */
  private position(): void {
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
    const bw = this.bubble.offsetWidth || 440;
    const bh = this.bubble.offsetHeight || 180;
    let x = vw / 2 - bw / 2;
    let y = vh / 2 - bh / 2;
    const place: Placement = step.anchor && 'placement' in step.anchor && step.anchor.placement ? step.anchor.placement : 'bottom';
    if (rect && rect.width > 0) {
      const gap = 18;
      if (place === 'bottom') { x = rect.left + rect.width / 2 - bw / 2; y = rect.bottom + gap; }
      if (place === 'top') { x = rect.left + rect.width / 2 - bw / 2; y = rect.top - gap - bh; }
      if (place === 'left') { x = rect.left - gap - bw; y = rect.top + rect.height / 2 - bh / 2; }
      if (place === 'right') { x = rect.right + gap; y = rect.top + rect.height / 2 - bh / 2; }
    }
    x = Math.max(12, Math.min(vw - bw - 12, x));
    y = Math.max(12, Math.min(vh - bh - 12, y));
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${y}px`;
    this.bubble.dataset['place'] = place;
  }

  private finish(): void {
    clearInterval(this.timer);
    this.root.hidden = true;
    try {
      localStorage.setItem(DONE_KEY, 'done');
    } catch {
      /* private mode */
    }
    selection.clear();
    leaveTraining();
    running = undefined;
  }
}
