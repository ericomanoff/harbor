/**
 * Tour step engine, free of DOM so it can be unit-tested. The UI layer
 * renders whatever step is current and calls next/back/skip; interactive
 * steps advance on their own once `waitFor` reports true (polled by tick).
 */
export interface TourStep {
  id: string;
  title: string;
  text: string;
  /** What to spotlight; resolved by the UI layer. */
  anchor?: TourAnchor;
  /** Interactive step: advances when this returns true. */
  waitFor?: () => boolean;
  /** Short instruction shown with a pointing hand while waiting. */
  cta?: string;
  onEnter?: () => void;
  onLeave?: () => void;
}

export type TourAnchor =
  | { kind: 'dom'; selector: string; placement?: Placement }
  | { kind: 'map'; key: string; placement?: Placement }
  | { kind: 'none' };

export type Placement = 'top' | 'bottom' | 'left' | 'right';

export type FinishReason = 'completed' | 'skipped';

export interface TourHooks {
  onStep(step: TourStep, index: number, total: number): void;
  onFinish(reason: FinishReason): void;
}

export class TourEngine {
  index = -1;
  finished = false;

  constructor(private readonly steps: TourStep[], private readonly hooks: TourHooks) {}

  get current(): TourStep | undefined {
    return this.steps[this.index];
  }

  get total(): number {
    return this.steps.length;
  }

  start(): void {
    if (this.steps.length === 0) {
      this.finish('completed');
      return;
    }
    this.goTo(0);
  }

  next(): void {
    if (this.finished) return;
    if (this.index >= this.steps.length - 1) {
      this.finish('completed');
      return;
    }
    this.goTo(this.index + 1);
  }

  back(): void {
    if (this.finished || this.index <= 0) return;
    this.goTo(this.index - 1);
  }

  skip(): void {
    this.finish('skipped');
  }

  /** Poll from the UI layer; advances an interactive step once its condition holds. */
  tick(): void {
    const s = this.current;
    if (!s?.waitFor || this.finished) return;
    if (s.waitFor()) this.next();
  }

  private goTo(i: number): void {
    this.current?.onLeave?.();
    this.index = i;
    const s = this.steps[i]!;
    s.onEnter?.();
    this.hooks.onStep(s, i, this.steps.length);
  }

  private finish(reason: FinishReason): void {
    if (this.finished) return;
    this.current?.onLeave?.();
    this.finished = true;
    this.hooks.onFinish(reason);
  }
}
