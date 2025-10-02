import { randomValue, findMatches, encVariants, computeKeywordCounts } from '../src/utils/text.js';

describe('text utilities', () => {
  describe('randomValue', () => {
    test('produces string of requested length and allowed charset', () => {
      const v = randomValue(32);
      expect(v).toHaveLength(32);
      expect(/^[a-z0-9]+$/.test(v)).toBe(true);
    });

    test('different calls are likely different (statistical)', () => {
      const a = randomValue(16);
      const b = randomValue(16);
      // Very small chance of collision; acceptable for unit test heuristic
      expect(a).not.toBe(b);
    });

    test('default length is 8', () => {
      expect(randomValue().length).toBe(8);
    });
  });

  describe('findMatches', () => {
    test('finds non-overlapping sequential matches', () => {
      const res = findMatches('abc xx abc yy abc', 'abc');
      expect(res).toEqual([[0,3],[7,10],[14,17]]);
    });

    test('returns empty when substring absent', () => {
      expect(findMatches('abcdef', 'zzz')).toEqual([]);
    });

    test('returns empty when text undefined', () => {
      expect(findMatches(undefined, 'a')).toEqual([]);
    });

    test('handles single-character repeated pattern', () => {
      const res = findMatches('aaaa', 'a');
      expect(res).toEqual([[0,1],[1,2],[2,3],[3,4]]);
    });
  });

  describe('encVariants', () => {
    test('encodes URL and HTML entities and Unicode pieces', () => {
      const { url, html, jsUniPieces } = encVariants("<a&>");
      expect(url).toBe(encodeURIComponent('<a&>'));
      expect(html).toBe('&lt;a&amp;&gt;');
      expect(jsUniPieces).toEqual(['\\u003C','\\u0061','\\u0026','\\u003E']);
    });

    test('unicode astral symbols produce \\uXXXX sequence per code point', () => {
      const s = 'A😀'; // 'A' + surrogate pair U+1F600
      const { jsUniPieces } = encVariants(s);
      // Each JavaScript iteration yields a full code point (A + 😀)
      expect(jsUniPieces).toEqual(['\\u0041','\\u1F600']);
    });
  });

  describe('computeKeywordCounts', () => {
    test('counts occurrences for multiple distinct keywords', () => {
      const text = 'alpha beta alpha gamma beta beta';
      const counts = computeKeywordCounts(text, ['alpha', 'beta', 'gamma', 'delta']);
      expect(counts).toEqual([2, 3, 1, 0]);
    });

    test('returns zeros when keywords absent', () => {
      const text = 'zzz yyy xxx';
      const counts = computeKeywordCounts(text, ['nope', 'missing']);
      expect(counts).toEqual([0, 0]);
    });

    test('empty keyword list returns empty array', () => {
      const counts = computeKeywordCounts('anything here', []);
      expect(counts).toEqual([]);
    });
  });
});
