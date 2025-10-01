// Text & encoding related helpers

export const randomValue = (length = 8): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

export const findMatches = (text: string | undefined, substring: string): Array<[number, number]> => {
  if (!text) return [];
  const matches: Array<[number, number]> = [];
  let startIndex = 0;
  while (true) {
    const start = text.indexOf(substring, startIndex);
    if (start === -1) break;
    const end = start + substring.length;
    matches.push([start, end]);
    startIndex = end;
  }
  return matches;
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
