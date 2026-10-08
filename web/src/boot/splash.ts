/**
 * The loading screen: HTML visible from the first paint, before Phaser and
 * the atlases exist, faded out once the map is ready. Stage text is a pure
 * function so it can be tested without a DOM.
 */
export type Stage = 'assets' | 'fonts' | 'backend' | 'sail';

export function stageLine(stage: Stage, harbor?: string): string {
  switch (stage) {
    case 'assets': return 'Loading the charts…';
    case 'fonts': return 'Hoisting the flags…';
    case 'backend': return harbor ? `Hailing ${harbor}…` : 'Hailing the harbor master…';
    case 'sail': return 'Sailing in…';
  }
}

/** Overall progress reached when a stage completes. */
export const STAGE_PROGRESS: Record<Stage, number> = { assets: 0.7, fonts: 0.8, backend: 0.9, sail: 1 };

export const TIPS = [
  'Tab cycles through everything in the harbor.',
  'Drag a shipyard to move it to another slipway.',
  'Select a lighthouse to see which ships it guides.',
  'Right-drag pans; the wheel zooms; H fits the whole harbor.',
  'A burning ship is crash-looping. Refit replaces it.',
  'Scrap retires exactly the ships you selected.',
  'Charts (T) opens the Helm chart table.',
  'Find (/) locates any ship, shipyard or lighthouse by name.',
  'Fleets (F) hides the namespaces you are not sailing today.',
  'The Help button replays the welcome tour any time.',
];

/** Next tip index: always moves on, never repeats the one just shown. */
export function nextTip(prev: number, count = TIPS.length): number {
  if (count <= 1) return 0;
  return (prev + 1) % count;
}

const MIN_SHOW_MS = 600;
const FADE_MS = 350;
const TIP_MS = 2500;

export interface FailOptions {
  onRetry: () => void;
  onDemo: () => void;
}

export class Splash {
  private readonly root: HTMLElement | null;
  private readonly shownAt = performance.now();
  private tip = -1;
  private tipTimer?: ReturnType<typeof setInterval>;
  private finished?: Promise<void>;

  constructor(root: HTMLElement | null = document.getElementById('splash')) {
    this.root = root;
    if (!root) return;
    this.rotateTip();
    this.tipTimer = setInterval(() => this.rotateTip(), TIP_MS);
  }

  private q<T extends HTMLElement>(sel: string): T | null {
    return this.root?.querySelector<T>(sel) ?? null;
  }

  setStage(stage: Stage, harbor?: string): void {
    const line = this.q('.status');
    if (line) line.textContent = stageLine(stage, harbor);
    this.setProgress(stage === 'assets' ? 0 : STAGE_PROGRESS[stage === 'fonts' ? 'assets' : stage === 'backend' ? 'fonts' : 'backend']);
  }

  /** 0..1 overall. */
  setProgress(frac: number): void {
    const fill = this.q('.fill');
    if (fill) fill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  }

  setVersion(v: string): void {
    const el = this.q('.version');
    if (el) el.textContent = v ? `v${v}` : '';
  }

  fail(message: string, opts: FailOptions): void {
    if (!this.root) return;
    this.root.classList.add('failed');
    const line = this.q('.status');
    if (line) line.textContent = message;
    const retry = this.q<HTMLButtonElement>('button[data-retry]');
    const demo = this.q<HTMLButtonElement>('button[data-demo]');
    if (retry) retry.onclick = opts.onRetry;
    if (demo) demo.onclick = opts.onDemo;
    const actions = this.q('.actions');
    if (actions) actions.hidden = false;
  }

  /** Fades out after the minimum display time; resolves when gone. */
  done(): Promise<void> {
    this.finished ??= new Promise<void>((resolve) => {
      const root = this.root;
      if (!root) {
        resolve();
        return;
      }
      this.setProgress(1);
      const wait = Math.max(0, MIN_SHOW_MS - (performance.now() - this.shownAt));
      setTimeout(() => {
        root.classList.add('fade');
        setTimeout(() => {
          root.hidden = true;
          if (this.tipTimer) clearInterval(this.tipTimer);
          resolve();
        }, FADE_MS);
      }, wait);
    });
    return this.finished;
  }

  private rotateTip(): void {
    this.tip = nextTip(this.tip);
    const el = this.q('.tip');
    if (el) el.textContent = `Tip: ${TIPS[this.tip]}`;
  }
}

/** The one splash on the page; created on first use. */
let instance: Splash | undefined;
export function splash(): Splash {
  instance ??= new Splash();
  return instance;
}
