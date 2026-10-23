import { keepClear } from '../tour/keepClear';

/**
 * Keeps the bottom-centre column (the selection card) clear of the
 * bottom-right stack (toasts over the cluster panel), whether or not a speaker's dock is up:
 * the column slides left by a measured `--card-shift`, and when it cannot
 * slide far enough (the Shop and Charts buttons are in the way) the panel
 * folds to its HEALTH chips. Re-measured whenever either side changes size
 * or content, or the window resizes.
 */
const GAP = 16;

export function startPanelRoom(): () => void {
  const column = document.querySelector<HTMLElement>('#hud .hud-bottom-center');
  const panel = document.querySelector<HTMLElement>('#hud .cluster');
  const stack = document.querySelector<HTMLElement>('#hud .hud-bottom-right');
  const corner = document.querySelector<HTMLElement>('#hud .hud-bottom-left');
  if (!column || !panel || !stack) return () => {};
  let shift = 0;
  let folded = false;
  let capped = false; // the bubble is held above the card
  let fullWidth = 0; // the panel's width with both rows showing, remembered while folded
  let queued = false;
  const measure = (): void => {
    queued = false;
    const rect = column.getBoundingClientRect();
    const hasContent = rect.height > 0 && Array.from(column.children).some((c) => !(c as HTMLElement).hidden && c.getBoundingClientRect().height > 0);
    const base = { left: rect.left + shift, right: rect.right + shift }; // where the column sits with no shift
    const p = panel.getBoundingClientRect();
    if (!folded) fullWidth = p.width;
    // A toast above the panel may be wider than the folded panel: the stack's widest child counts.
    const toasts = stack.querySelector<HTMLElement>('.toasts')?.getBoundingClientRect();
    const toastWidth = toasts && toasts.height > 0 ? toasts.width : 0;
    // Folded, the panel is a column of the HEALTH chips: as wide as the widest chip.
    const chips = Array.from(panel.querySelectorAll<HTMLElement>('.crow:first-child .chip'));
    const healthWidth = chips.length ? Math.max(...chips.map((c) => c.getBoundingClientRect().width)) + 20 : p.width;
    const fullLeft = p.right - Math.max(folded ? Math.max(p.width, fullWidth) : p.width, toastWidth);
    const foldedLeft = p.right - Math.max(Math.min(p.width, healthWidth), toastWidth);
    const minLeft = corner?.getBoundingClientRect().right ?? 0;
    const r = hasContent && p.width > 0 ? keepClear(base, fullLeft, foldedLeft, minLeft, folded) : { shift: 0, fold: false };
    let want = r.shift;
    // Captain Huber's bubble (top right) can reach down to the card on a short window. The card
    // slides left of it when the Shop and Charts buttons leave the room; otherwise the bubble
    // is capped above the card (`--card-top`). Decided from the no-shift geometry, so it holds still.
    const captain = document.querySelector<HTMLElement>('#captain');
    const bubble = captain && !captain.hidden ? captain.querySelector<HTMLElement>('.bubble')?.getBoundingClientRect() : undefined;
    let cap = false;
    if (hasContent && bubble && bubble.height > 0 && bubble.bottom > rect.top) {
      const needed = Math.max(0, base.right + GAP - bubble.left);
      const room = Math.max(0, base.left - GAP - minLeft);
      if (needed <= room) want = Math.max(want, needed);
      else cap = true;
    }
    if (cap !== capped) {
      capped = cap;
      if (cap) document.body.style.setProperty('--card-top', `${Math.round(rect.top)}px`);
      else document.body.style.removeProperty('--card-top');
    } else if (cap) document.body.style.setProperty('--card-top', `${Math.round(rect.top)}px`);
    if (want !== shift) {
      shift = want;
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
  const bubbleEl = document.querySelector<HTMLElement>('#captain .bubble');
  if (bubbleEl) sizes.observe(bubbleEl);
  const changes = new MutationObserver(schedule);
  changes.observe(column, { childList: true, subtree: true, attributes: true, characterData: true });
  changes.observe(stack, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    sizes.disconnect();
    changes.disconnect();
    window.removeEventListener('resize', schedule);
    document.body.style.removeProperty('--card-shift');
    document.body.style.removeProperty('--card-top');
    panel.classList.remove('folded');
  };
}
