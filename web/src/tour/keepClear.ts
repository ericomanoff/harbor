/**
 * How far the bottom-centre column (toasts and the selection card) must
 * slide left so the cluster panel (bottom right) never overlaps it, and
 * whether the panel must fold to its HEALTH row because the column cannot
 * slide far enough. (It was written for Captain Huber's bubble, which has
 * since moved to the top right; the arithmetic is the same.)
 *
 * `card` is the column's rectangle as it would sit with no shift; `bubbleLeft`
 * is the panel's left edge at its full width (the right edge is fixed to the
 * screen); `minLeft` is the first x the column may not cross (the Shop and
 * Charts buttons). Hysteresis keeps a fold from flapping.
 */
export function keepClear(card: { left: number; right: number }, bubbleLeft: number, foldedLeft: number, minLeft: number, folded: boolean, gap = 16): { shift: number; fold: boolean } {
  if (card.right <= card.left) return { shift: 0, fold: false };
  const needed = Math.max(0, card.right + gap - bubbleLeft);
  const room = Math.max(0, card.left - gap - minLeft);
  if (needed <= room - (folded ? 40 : 0)) return { shift: needed, fold: false };
  // Folded, the bubble is narrower and the portrait is gone: slide only as far as that needs.
  return { shift: Math.min(room, Math.max(0, card.right + gap - foldedLeft)), fold: true };
}
