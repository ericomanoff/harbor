const TTL_MS = 4500;
const MAX = 4;

/** Short-lived announcements stacked under the top bar. */
export class Toasts {
  constructor(private readonly root: HTMLElement) {}

  push(text: string, kind: 'info' | 'warn' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.root.append(el);
    while (this.root.children.length > MAX) this.root.firstElementChild?.remove();
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 400);
    }, TTL_MS);
  }
}
