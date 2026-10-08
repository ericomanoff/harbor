/**
 * Splits a command line the way a POSIX shell would for simple cases:
 * whitespace separates words, single quotes keep everything literal, double
 * quotes allow \\" and \\\\ escapes. Enough for `sh -c "sleep 2; echo done"`.
 */
export function shellSplit(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inWord = false;
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else cur += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < line.length && (line[i + 1] === '"' || line[i + 1] === '\\')) {
        cur += line[++i]!;
      } else if (ch === '"') quote = undefined;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) {
        out.push(cur);
        cur = '';
        inWord = false;
      }
      continue;
    }
    if (ch === '\\' && i + 1 < line.length) {
      cur += line[++i]!;
      inWord = true;
      continue;
    }
    cur += ch;
    inWord = true;
  }
  if (quote) throw new Error(`unclosed ${quote === '"' ? 'double' : 'single'} quote`);
  if (inWord) out.push(cur);
  return out;
}
