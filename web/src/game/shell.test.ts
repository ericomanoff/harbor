import { describe, expect, it } from 'vitest';
import { shellSplit } from './shell';

describe('shellSplit', () => {
  it('splits on whitespace and honours quotes', () => {
    expect(shellSplit('sh -c "sleep 2; echo done"')).toEqual(['sh', '-c', 'sleep 2; echo done']);
    expect(shellSplit("echo 'a  b' c")).toEqual(['echo', 'a  b', 'c']);
    expect(shellSplit('  spaced   out  ')).toEqual(['spaced', 'out']);
    expect(shellSplit('')).toEqual([]);
  });
  it('handles escapes and empty quoted words', () => {
    expect(shellSplit('printf "say \\"hi\\"" ""')).toEqual(['printf', 'say "hi"', '']);
    expect(shellSplit('a\\ b c')).toEqual(['a b', 'c']);
  });
  it('rejects unclosed quotes', () => {
    expect(() => shellSplit('sh -c "oops')).toThrow(/unclosed double/);
    expect(() => shellSplit("echo 'oops")).toThrow(/unclosed single/);
  });
});
