import { getTags, inQuotes, getReflectionContext } from '../src/analysis/bodyReflection/context.js';

// Helper to locate first occurrence of substring and return match tuple
const locate = (body: string, substr: string): [number, number] => {
  const idx = body.indexOf(substr);
  if (idx === -1) throw new Error(`substring ${substr} not found in test body`);
  return [idx, idx + substr.length];
};

describe('context utilities', () => {
  describe('getTags', () => {
    test('extracts simple tags in order', () => {
      const body = '<div>Hi<script>var a=1;</script><SPAN attr="x">text</SPAN>';
      const tags = getTags(body).map(t => t.name);
      // Closing tags are prefixed with '/' by current implementation
      expect(tags).toEqual(['div', 'script', '/script', 'span', '/span']);
    });

    test('handles attributes and different spacing', () => {
      const body = '<img src="x" alt="y"/> <a  href="#">link</a>';
      const tags = getTags(body);
      expect(tags[0].name).toBe('img');
      expect(tags[1].name).toBe('a');
    });
  });

  describe('inQuotes', () => {
    test('detects inside double quotes in tag attribute', () => {
      const body = '<div data-x="HELLO"></div>';
      const tags = getTags(body);
      const match = locate(body, 'HELLO');
      const tag = tags.find(t => t.name === 'div')!;
      expect(inQuotes(body, match[0], match[1], tag, '"')).toBe(true);
    });

    test('returns false when outside quotes', () => {
      const body = '<div>HELLO</div>';
      const tag = getTags(body)[0];
      const match = locate(body, 'HELLO');
      expect(inQuotes(body, match[0], match[1], tag, '"')).toBe(false);
    });
  });

  describe('getReflectionContext', () => {
    test('HTML outside of any tag → HTML', () => {
      const body = 'HELLO<div></div>';
      const match = locate(body, 'HELLO');
      expect(getReflectionContext([match], body)).toBe('HTML');
    });

    test('inside tag unquoted attribute value', () => {
      const body = '<div class=HELLO></div>';
      const match = locate(body, 'HELLO');
      expect(getReflectionContext([match], body)).toBe('Tag');
    });

    test('inside tag quoted attribute value (double)', () => {
      const body = '<div data-x="HELLO"></div>';
      const match = locate(body, 'HELLO');
      expect(getReflectionContext([match], body)).toBe('Tag Attribute (\") Value');
    });

    test('inside tag quoted attribute value (single)', () => {
      const body = "<div data-x='HELLO'></div>";
      const match = locate(body, 'HELLO');
      expect(getReflectionContext([match], body)).toBe("Tag Attribute (') Value");
    });

    // Current heuristic does not classify inside <script> contents specially; returns HTML
    test('inside script raw (no quotes) currently treated as HTML', () => {
      const body = '<script>var X=HELLO;</script>';
      const match = locate(body, 'HELLO');
      expect(getReflectionContext([match], body)).toBe('HTML');
    });

    test('inside script quoted double currently treated as HTML', () => {
      const body = '<script>var X="HELLO";</script>';
      const match = locate(body, 'HELLO');
      expect(getReflectionContext([match], body)).toBe('HTML');
    });

    test('inside script quoted single currently treated as HTML', () => {
      const body = "<script>var X='HELLO';</script>";
      const match = locate(body, 'HELLO');
      expect(getReflectionContext([match], body)).toBe('HTML');
    });

    test('fallback BODY when no matches passed', () => {
      const body = '<div>nothing</div>';
      expect(getReflectionContext([], body)).toBe('BODY');
    });
  });
});
