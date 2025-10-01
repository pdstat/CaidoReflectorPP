// Body reflection context utilities extracted from reflector++.ts
// Provides lightweight DOM-less heuristics to classify reflection contexts.

export interface Tag {
  start: number;
  end: number;
  name: string; // lowercase tag name
}

// Scan for <tag ...> occurrences; naive but fast for reflection classification purposes.
export const getTags = (body: string): Tag[] => {
  const tags: Tag[] = [];
  let start = 0;
  while (true) {
    start = body.indexOf("<", start);
    if (start === -1) break;
    const end = body.indexOf(">", start);
    if (end === -1) break;
    const name = body.slice(start + 1, end).split(/\s+/)[0].toLowerCase();
    tags.push({ start, end: end + 1, name });
    start = end + 1;
  }
  return tags;
};

// Determine whether the reflection range lies inside a quoted attribute or script string.
export const inQuotes = (body: string, start: number, end: number, tag: Tag, quoteChar: string) => {
  let inQuote = false;
  for (let i = tag.start; i < start; i++) {
    if (body[i] === quoteChar) inQuote = !inQuote;
  }
  if (!inQuote) return false;
  for (let i = start; i < end; i++) {
    if (body[i] === quoteChar) { inQuote = !inQuote; }
  }
  return inQuote; // true only if we never closed before end
};

// Classify reflection context based on surrounding tag / quotes.
export const getReflectionContext = (
  matches: Array<[number, number]>,
  body: string,
  precomputedTags?: Tag[]
): string => {
  const CONTEXTS = {
    OUT_OF_TAG: "HTML",
    TAG_UNQUOTED: "Tag",
    TAG_DQUOTE: 'Tag Attribute (") Value',
    TAG_SQUOTE: "Tag Attribute (') Value",
    SCRIPT_UNQUOTED: "Script",
    SCRIPT_DQUOTE: 'Script String (")',
    SCRIPT_SQUOTE: "Script String (')",
    FALLBACK: "BODY"
  } as const;

  const tags = precomputedTags ?? getTags(body);

  const classifyInsideTag = (tag: Tag, start: number, end: number): string => {
    const isScript = tag.name === "script";
    const dQuoted = inQuotes(body, start, end, tag, '"');
    if (dQuoted) return isScript ? CONTEXTS.SCRIPT_DQUOTE : CONTEXTS.TAG_DQUOTE;
    const sQuoted = inQuotes(body, start, end, tag, "'");
    if (sQuoted) return isScript ? CONTEXTS.SCRIPT_SQUOTE : CONTEXTS.TAG_SQUOTE;
    return isScript ? CONTEXTS.SCRIPT_UNQUOTED : CONTEXTS.TAG_UNQUOTED;
  };

  for (const [start, end] of matches) {
    const containing = tags.find(t => t.start < start && t.end > end);
    if (!containing) return CONTEXTS.OUT_OF_TAG;
    return classifyInsideTag(containing, start, end);
  }
  return CONTEXTS.FALLBACK; // no matches -> fallback
};
