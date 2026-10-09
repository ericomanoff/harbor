import type { HintedStep } from '../tour/bubbleUI';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`challenge: missing ${sel}`);
  return el;
};

const fmt = (s: number): string => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

/**
 * Challenge mode: no harbor master, just the objectives (the level's goal
 * steps), a running clock against par, and a way out.
 */
export class ChallengeUI {
  private readonly root: HTMLElement;
  private readonly goals: { index: number; text: string }[];

  constructor(title: string, steps: HintedStep[], private readonly parSeconds: number, onLeave: () => void) {
    this.root = $('#challenge');
    this.goals = steps.map((s, index) => ({ index, text: s.cta ?? s.title })).filter((g) => steps[g.index]?.waitFor);
    $('.lvl', this.root).textContent = title;
    $('.par', this.root).textContent = `par ${fmt(parSeconds)}`;
    $('[data-leave]', this.root).onclick = onLeave;
    $('.objectives', this.root).replaceChildren(...this.goals.map((g) => Object.assign(document.createElement('li'), { textContent: g.text })));
    this.root.hidden = false;
    this.tick(0);
  }

  /** Marks objectives before the current step as done. */
  show(stepIndex: number): void {
    const items = this.root.querySelectorAll<HTMLLIElement>('.objectives li');
    this.goals.forEach((g, i) => {
      const li = items[i];
      if (!li) return;
      li.classList.toggle('done', g.index < stepIndex);
      li.classList.toggle('now', g.index === stepIndex);
    });
  }

  tick(seconds: number): void {
    const t = $('.timer', this.root);
    t.textContent = fmt(seconds);
    t.classList.toggle('over', seconds > this.parSeconds);
  }

  destroy(): void {
    this.root.hidden = true;
  }
}
