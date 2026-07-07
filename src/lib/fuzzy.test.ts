import { describe, expect, it } from 'vitest';
import { score } from './fuzzy';

describe('score', () => {
  it('returns 0 for an empty query (matches everything equally)', () => {
    expect(score('', 'anything')).toBe(0);
  });

  it('returns -Infinity when the query is not a subsequence of the target', () => {
    expect(score('xyz', 'readme')).toBe(-Infinity);
  });

  it('scores an exact match highest', () => {
    const exact = score('readme', 'readme');
    const substring = score('read', 'readme');
    const subsequence = score('rde', 'readme');
    expect(exact).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
  });

  it('scores a prefix match higher than a mid-string substring match', () => {
    const prefix = score('rea', 'readme file');
    const midstring = score('me ', 'readme file');
    expect(prefix).toBeGreaterThan(midstring);
  });

  it('is case-insensitive', () => {
    expect(score('README', 'readme')).toBe(score('readme', 'readme'));
  });

  it('penalizes gaps between subsequence characters', () => {
    const tight = score('rdm', 'rdm-tight');
    const loose = score('rdm', 'r-a-n-d-o-m');
    expect(tight).toBeGreaterThan(loose);
  });
});
