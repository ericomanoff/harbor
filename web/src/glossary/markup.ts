import { ALIASES, isNavalAlias, pairOf, termFor } from './terms';

export interface Segment {
  text: string;
  /** Glossary id when this segment is a term. */
  term?: string;
  /** True for the naval side of a pair. */
  naval?: boolean;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word, case-insensitive, longest alias first; possessives like "ship's" still match "ship". */
const aliasPattern = new RegExp(String.raw`(?<![\w'-])(${ALIASES.map(escape).join('|')})(?![\w-])`, 'gi');

/** Splits text into plain and term segments. Pure; tested. */
export function segmentTerms(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(aliasPattern)) {
    const start = m.index ?? 0;
    const word = m[0];
    const term = termFor(word);
    if (!term) continue;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: word, term: term.id, naval: isNavalAlias(word) });
    last = start + word.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'ABBR', 'CANVAS', 'PRE', 'CODE', 'A', 'BUTTON']);

export interface MarkupOptions {
  /** Append the Kubernetes term after naval ones: "shipyard (Deployment)". */
  bothLanguages?: boolean;
}

/**
 * Wraps glossary terms in `<abbr class="term" data-term>` under root.
 * Idempotent: already-wrapped text is skipped. The first term in each
 * element gets `first` (the visible underline); the rest are hoverable only.
 */
export function markupTerms(root: Element, opts: MarkupOptions = {}): number {
  let count = 0;
  // The root itself may be a button or a no-terms panel (the observer hands
  // over whichever element changed), so it and its ancestors count too.
  for (let el: Element | null = root; el; el = el.parentElement) {
    if (SKIP.has(el.tagName) || el.hasAttribute('data-no-terms')) return 0;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      let el = n.parentElement;
      while (el && el !== root) {
        if (SKIP.has(el.tagName) || el.hasAttribute('data-no-terms')) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return n.textContent && /\S/.test(n.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const seenPerElement = new WeakMap<Element, Set<string>>();
  for (const node of nodes) {
    const segs = segmentTerms(node.textContent ?? '');
    if (!segs.some((s) => s.term)) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const seen = seenPerElement.get(parent) ?? new Set<string>();
    seenPerElement.set(parent, seen);
    const frag = document.createDocumentFragment();
    for (const s of segs) {
      if (!s.term) {
        frag.append(document.createTextNode(s.text));
        continue;
      }
      const abbr = document.createElement('abbr');
      abbr.className = `term${seen.has(s.term) ? '' : ' first'}`;
      abbr.dataset['term'] = s.term;
      abbr.tabIndex = 0;
      abbr.textContent = s.text;
      const term = termFor(s.text);
      const pair = term && s.naval ? pairOf(term) : undefined;
      if (opts.bothLanguages && pair && !seen.has(s.term)) {
        const k = document.createElement('span');
        k.className = 'k8s';
        k.textContent = ` (${pair})`;
        abbr.append(k);
      }
      seen.add(s.term);
      frag.append(abbr);
      count++;
    }
    node.replaceWith(frag);
  }
  return count;
}
