import { keepClear } from '../tour/keepClear';

/**
 * Keeps the bottom-centre column (toasts, selection card) clear of the
 * cluster panel at the bottom right, whether or not a speaker's dock is up:
 * the column slides left by a measured `--card-shift`, and when it cannot
 * slide far enough (the Shop and Charts buttons are in the way) the panel
 * folds to its HEALTH chips. Re-measured whenever either side changes size
 * or content, or the window resizes.
 */
export function startPanelRoom(): () => void {
  const column = document.querySelector<HTMLElement>('#hud .hud-bottom-center');
  const panel = document.querySelector<HTMLElement>('#hud .cluster');
  const corner = document.querySelector<HTMLElement>('#hud .hud-bottom-left');
  if (!column || !panel) return () => {};
  let shift = 0;
  let folded = false;
  let fullWidth = 0; // the panel's width with both rows showing, remembered while folded
  let queued = false;
  const measure = (): void => {
    queued = false;
    const rect = column.getBoundingClientRect();
    const hasContent = rect.height > 0 && Array.from(column.children).some((c) => !(c as HTMLElement).hidden && c.getBoundingClientRect().height > 0);
    const base = { left: rect.left + shift, right: rect.right + shift }; // where the column sits with no shift
    const p = panel.getBoundingClientRect();
    if (!folded) fullWidth = p.width;
    // Folded, the panel is a column of the HEALTH chips: as wide as the widest chip.
    const chips = Array.from(panel.querySelectorAll<HTMLElement>('.crow:first-child .chip'));
    const healthWidth = chips.length ? Math.max(...chips.map((c) => c.getBoundingClientRect().width)) + 20 : p.width;
    const fullLeft = p.right - (folded ? Math.max(p.width, fullWidth) : p.width);
    const foldedLeft = p.right - Math.min(p.width, healthWidth);
    const minLeft = corner?.getBoundingClientRect().right ?? 0;
    const r = hasContent && p.width > 0 ? keepClear(base, fullLeft, foldedLeft, minLeft, folded) : { shift: 0, fold: false };
    if (r.shift !== shift) {
      shift = r.shift;
      document.body.style.setProperty('--card-shift', `${shift}px`);
    }
    if (r.fold !== folded) {
      folded = r.fold;
      panel.classList.toggle('folded', folded);
    }
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  };
  const sizes = new ResizeObserver(schedule);
  sizes.observe(column);
  sizes.observe(panel);
  if (corner) sizes.observe(corner);
  const changes = new MutationObserver(schedule);
  changes.observe(column, { childList: true, subtree: true, attributes: true, characterData: true });
  changes.observe(panel, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    sizes.disconnect();
    changes.disconnect();
    window.removeEventListener('resize', schedule);
    document.body.style.removeProperty('--card-shift');
    panel.classList.remove('folded');
  };
}
