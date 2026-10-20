import { settings } from '../app';
import { markupTerms } from './markup';
import { openGlossary } from './panel';
import { Tooltip } from './tooltip';

export { openGlossary } from './panel';

let tooltip: Tooltip | undefined;

/**
 * Starts the glossary: a tooltip, and a MutationObserver that marks up
 * terms in the HUD, overlays and tour bubbles whenever they (re)render.
 * Marking up never touches inputs, logs or code, and is idempotent.
 */
export function startGlossary(): Tooltip {
  if (tooltip) return tooltip;
  tooltip = new Tooltip((id) => openGlossary(id));
  const roots = ['#hud', '#captain', '.overlay'];
  const inScope = (el: Element): Element | null => {
    for (const sel of roots) {
      const r = el.closest(sel);
      if (r && !el.closest('#glossary') && !el.closest('#term-tip')) return r;
    }
    return null;
  };
  let scheduled = false;
  const pending = new Set<Element>();
  const flush = (): void => {
    scheduled = false;
    const opts = { bothLanguages: settings.bothLanguages };
    for (const el of pending) markupTerms(el, opts);
    pending.clear();
  };
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      const target = m.type === 'characterData' ? m.target.parentElement : (m.target as Element);
      if (!target) continue;
      const root = inScope(target);
      if (!root) continue;
      pending.add(target.nodeType === Node.ELEMENT_NODE ? target : root);
    }
    if (pending.size && !scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  // Mark up what is already there.
  for (const sel of roots) document.querySelectorAll(sel).forEach((el) => { if (!el.closest('#glossary')) markupTerms(el, { bothLanguages: settings.bothLanguages }); });
  settings.changed.on(() => remarkAll());
  return tooltip;
}

/** After the both-languages switch flips, strip and redo the markup. */
function remarkAll(): void {
  for (const abbr of Array.from(document.querySelectorAll('abbr.term'))) {
    const k = abbr.querySelector('.k8s');
    k?.remove();
    abbr.replaceWith(document.createTextNode(abbr.textContent ?? ''));
  }
  for (const sel of ['#hud', '#captain', '.overlay']) {
    document.querySelectorAll(sel).forEach((el) => {
      if (el.closest('#glossary')) return;
      el.normalize();
      markupTerms(el, { bothLanguages: settings.bothLanguages });
    });
  }
}

export function glossaryTooltip(): Tooltip | undefined {
  return tooltip;
}
