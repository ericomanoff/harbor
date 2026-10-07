import { modal } from '../app';
import { isSystemNamespace } from '../layout/colors';
import type { ClusterStore } from '../store/cluster';

/** Shared open/close for the HTML overlays; keeps the modal flag honest. */
export function openOverlay(id: string, onClose?: () => void): () => void {
  const root = document.getElementById(id);
  if (!root) throw new Error(`overlay ${id} missing`);
  const close = (): void => {
    if (root.hidden) return;
    root.hidden = true;
    root.onkeydown = null;
    modal.set(false);
    onClose?.();
  };
  root.onkeydown = (ev) => {
    if (ev.key === 'Escape') close();
    ev.stopPropagation();
  };
  root.hidden = false;
  modal.set(true);
  return close;
}

/** Namespace names for a select: user namespaces first, then system ones. */
export function nsOptions(store: Pick<ClusterStore, 'namespaces'>): string[] {
  return [...store.namespaces.keys()].sort((a, b) => Number(isSystemNamespace(a)) - Number(isSystemNamespace(b)) || a.localeCompare(b));
}
