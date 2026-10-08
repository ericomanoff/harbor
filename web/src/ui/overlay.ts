import { modal } from '../app';
import { isSystemNamespace } from '../layout/colors';
import type { ClusterStore } from '../store/cluster';

/** Shared open/close for the HTML overlays; keeps the modal flag honest. */
export function openOverlay(id: string, onClose?: () => void): () => void {
  const root = document.getElementById(id);
  if (!root) throw new Error(`overlay ${id} missing`);
  // Escape closes from anywhere (an overlay need not hold focus, e.g. logs);
  // keys typed inside the overlay stop at its root so Phaser never sees them.
  const onEscape = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  };
  const close = (): void => {
    if (root.hidden) return;
    root.hidden = true;
    root.onkeydown = null;
    window.removeEventListener('keydown', onEscape, true);
    modal.set(false);
    onClose?.();
  };
  root.onkeydown = (ev) => ev.stopPropagation();
  window.addEventListener('keydown', onEscape, true);
  root.hidden = false;
  modal.set(true);
  return close;
}

/** Namespace names for a select: user namespaces first, then system ones. */
export function nsOptions(store: Pick<ClusterStore, 'namespaces'>): string[] {
  return [...store.namespaces.keys()].sort((a, b) => Number(isSystemNamespace(a)) - Number(isSystemNamespace(b)) || a.localeCompare(b));
}
