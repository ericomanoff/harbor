import { termById, titleOf } from './terms';

/** One tooltip for the whole page; shown for `[data-term]` elements and map hovers. */
export class Tooltip {
  private readonly el: HTMLElement;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private onOpenGlossary?: (id: string) => void;

  constructor(onOpenGlossary?: (id: string) => void) {
    this.onOpenGlossary = onOpenGlossary;
    this.el = document.createElement('div');
    this.el.id = 'term-tip';
    this.el.className = 'hud';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="pair"></div><div class="concept"></div><div class="use"></div><div class="harbor"></div><div class="more">Click for more</div>';
    document.body.append(this.el);
    this.el.onmouseenter = () => this.cancelHide();
    this.el.onmouseleave = () => this.scheduleHide();
    this.el.onclick = () => {
      const id = this.el.dataset['term'];
      if (id) this.onOpenGlossary?.(id);
    };
    document.addEventListener('mouseover', (ev) => {
      const abbr = (ev.target as Element | null)?.closest?.('abbr.term') as HTMLElement | null;
      if (abbr?.dataset['term']) this.showFor(abbr.dataset['term'], abbr.getBoundingClientRect());
    });
    document.addEventListener('mouseout', (ev) => {
      if ((ev.target as Element | null)?.closest?.('abbr.term')) this.scheduleHide();
    });
    document.addEventListener('focusin', (ev) => {
      const abbr = (ev.target as Element | null)?.closest?.('abbr.term') as HTMLElement | null;
      if (abbr?.dataset['term']) this.showFor(abbr.dataset['term'], abbr.getBoundingClientRect());
    });
    document.addEventListener('focusout', () => this.scheduleHide());
    document.addEventListener('click', (ev) => {
      const abbr = (ev.target as Element | null)?.closest?.('abbr.term') as HTMLElement | null;
      if (abbr?.dataset['term']) {
        ev.preventDefault();
        this.onOpenGlossary?.(abbr.dataset['term']);
      }
    });
  }

  /**
   * Shows the entry near a rectangle (page coordinates). A tooltip raised by
   * hovering the map must not catch the click meant for the thing under it,
   * so it is click-through; tooltips over text keep "Click for more".
   */
  showFor(id: string, anchor: DOMRect, clickable = true, subject?: string): void {
    const term = termById(id);
    if (!term) return;
    this.cancelHide();
    this.el.dataset['term'] = id;
    this.el.style.pointerEvents = clickable ? '' : 'none';
    this.el.querySelector<HTMLElement>('.more')!.hidden = !clickable;
    this.el.querySelector('.pair')!.textContent = subject ? `${titleOf(term)} ${subject}` : titleOf(term);
    this.el.querySelector('.concept')!.textContent = term.concept;
    const use = this.el.querySelector<HTMLElement>('.use')!;
    use.hidden = !term.useCase;
    use.textContent = term.useCase ?? '';
    this.el.querySelector('.harbor')!.textContent = `In the harbor: ${term.inHarbor}`;
    this.el.hidden = false;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let x = anchor.left + anchor.width / 2 - w / 2;
    let y = anchor.top - h - 10;
    if (y < 8) y = anchor.bottom + 10;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.classList.toggle('below', y > anchor.top);
  }

  hide(): void {
    this.el.hidden = true;
  }

  private scheduleHide(): void {
    this.cancelHide();
    this.hideTimer = setTimeout(() => this.hide(), 160);
  }

  private cancelHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }
}
