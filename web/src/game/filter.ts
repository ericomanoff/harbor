import { isSystemNamespace } from '../layout/colors';

export interface NamespaceFilter {
  showSystemNamespaces: boolean;
  hiddenNamespaces: ReadonlySet<string>;
}

/** Whether objects in a namespace are drawn at all. */
export function namespaceVisible(ns: string, f: NamespaceFilter): boolean {
  if (f.hiddenNamespaces.has(ns)) return false;
  return f.showSystemNamespaces || !isSystemNamespace(ns);
}

/** Short status for the sidebar: how many namespaces are hidden by choice. */
export function filterSummary(all: Iterable<string>, f: NamespaceFilter): string {
  let hidden = 0;
  let total = 0;
  for (const ns of all) {
    total++;
    if (!namespaceVisible(ns, f)) hidden++;
  }
  // Namespaces are fleets, each flying its own flag: the chip keeps the glyph and the harbor word.
  const word = total === 1 ? 'fleet' : 'fleets';
  return hidden === 0 ? `⚑ all ${total} ${word}` : `⚑ ${hidden}/${total} ${word} hidden`;
}
