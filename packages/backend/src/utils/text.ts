// Text & encoding related helpers

export const randomValue = (length = 8): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

const containsUrlEncodedValues = (str: unknown): boolean => {
  if (typeof str !== 'string' || str.length === 0) return false;
  // case-insensitive: handles %2a, %2A, etc.
  return /%[0-9A-F]{2}/i.test(str);
};

const findAll = (text: string, needle: string): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  if (needle.length === 0) return out;

  let startIndex = 0;
  while (true) {
    const start = text.indexOf(needle, startIndex);
    if (start === -1) break;
    const end = start + needle.length;
    out.push([start, end]);
    startIndex = end; // non-overlapping, same behavior as your original
  }
  return out;
};

export const findMatches = (text: string | undefined, substring: string, sdk?: SDK): Array<[number, number]> => {
  if (!text) return [];

  // 1) literal match
  const literalMatches = findAll(text, substring);
  if (literalMatches.length > 0) return literalMatches;

  // If it doesn't look URL-encoded at all, we're done.
  if (!containsUrlEncodedValues(substring)) return [];

  sdk.console.log(`[Reflector++] No literal matches for "${substring}", trying URL-decoded variants`);
  // 2) decode once, try again
  let onceDecoded: string | null = null;
  try {
    onceDecoded = decodeURIComponent(substring);
  } catch {
    // malformed percent-encoding; nothing more to do
    return [];
  }

  const onceDecodedMatches = findAll(text, onceDecoded);
  if (onceDecodedMatches.length > 0) return onceDecodedMatches;

  // 3) decode twice (handle double-encoded inputs), try again
  try {
    const twiceDecoded = decodeURIComponent(onceDecoded);
    const twiceDecodedMatches = findAll(text, twiceDecoded);
    if (twiceDecodedMatches.length > 0) return twiceDecodedMatches;
  } catch {
    // second decode failed; fall through to empty result
  }

  return [];
};


export function encVariants(raw: string): { url: string; html: string; jsUniPieces: string[] } {
  const url = encodeURIComponent(raw);
  const html = raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const jsUniPieces: string[] = [];
  for (const ch of raw) {
    const cp = ch.codePointAt(0)!;
    jsUniPieces.push('\\u' + cp.toString(16).padStart(4, '0').toUpperCase());
  }
  return { url, html, jsUniPieces };
}

// Count occurrences of each keyword string in given text using findMatches logic.
export function computeKeywordCounts(text: string, keywords: string[]): number[] {
  return keywords.map(k => findMatches(text, k).length);
}
