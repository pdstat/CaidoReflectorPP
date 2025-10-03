// Canonical context mapping and helpers centralizing normalization logic.
// This reduces duplication across scoring, reporting, and detection layers.

export type CanonicalContext =
  | 'js' | 'jsInQuote'
  | 'css' | 'cssInQuote'
  | 'eventHandler' | 'eventHandlerEscaped'
  | 'attribute' | 'attributeInQuote' | 'attributeEscaped'
  | 'html' | 'htmlComment'
  | 'jsonEscaped'
  | 'responseHeader';

// Centralized constant references to avoid string literal drift across modules.
export const CONTEXT = Object.freeze({
  JS: 'js' as CanonicalContext,
  JS_IN_QUOTE: 'jsInQuote' as CanonicalContext,
  CSS: 'css' as CanonicalContext,
  CSS_IN_QUOTE: 'cssInQuote' as CanonicalContext,
  EVENT_HANDLER: 'eventHandler' as CanonicalContext,
  EVENT_HANDLER_ESCAPED: 'eventHandlerEscaped' as CanonicalContext,
  ATTRIBUTE: 'attribute' as CanonicalContext,
  ATTRIBUTE_IN_QUOTE: 'attributeInQuote' as CanonicalContext,
  ATTRIBUTE_ESCAPED: 'attributeEscaped' as CanonicalContext,
  HTML: 'html' as CanonicalContext,
  HTML_COMMENT: 'htmlComment' as CanonicalContext,
  JSON_ESCAPED: 'jsonEscaped' as CanonicalContext,
  RESPONSE_HEADER: 'responseHeader' as CanonicalContext,
});

// Alias (input) -> canonical context mapping.
const ALIASES: Record<string, CanonicalContext> = {
  'script': 'js',
  'script string': 'jsInQuote',
  'style': 'css',
  'style string': 'cssInQuote',
  'response header': 'responseHeader',
  'tag attribute (\") value': 'attributeInQuote',
  "tag attribute (') value": 'attributeInQuote',
  'html': 'html',
  'html comment': 'htmlComment'
};

// Accept set for direct canonical names (lowercase form)
const CANONICAL_SET = new Set<CanonicalContext>([
  'js','jsInQuote','css','cssInQuote','eventHandler',
  'eventHandlerEscaped','attribute','attributeInQuote',
  'attributeEscaped','html','htmlComment','jsonEscaped','responseHeader'
]);

export function toCanonical(raw?: string): CanonicalContext | undefined {
  if (!raw) return undefined;
  const norm = raw.trim().toLowerCase();
  if ((ALIASES as any)[norm]) return ALIASES[norm];
  // remove common decoration words
  const simplified = norm.replace(/\s+value$/,'').replace(/\s*\(quoted\)/,'');
  // Direct lowercase canonical match (case-insensitive for camelCase entries)
  for (const c of CANONICAL_SET) {
    if (c.toLowerCase() === simplified) return c;
  }
  return undefined; // unknown / leave as-is at call site if needed
}

export function isEscapedCanonical(ctx?: CanonicalContext | string): boolean {
  if (!ctx) return false;
  const c = (ctx as string).toLowerCase();
  return c === 'attributeescaped' || c === 'eventhandlerescaped' || c === 'jsonescaped';
}

// Human readable label (used in reporting)
export function prettyPrintContext(raw?: string): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower === 'htmlcomment') return 'HTML Comment';
  const canonical = toCanonical(raw) ?? raw; // fallback to raw
  switch (canonical) {
    case 'js': return 'Script';
    case 'jsInQuote': return 'Script String';
    case 'css': return 'Style';
    case 'cssInQuote': return 'Style String';
    case 'eventHandler': return 'Event Handler Attribute';
    case 'eventHandlerEscaped': return 'Event Handler Attribute (encoded)';
    case 'attribute': return 'Tag Attribute (unquoted) Value';
    case 'attributeInQuote': return 'Tag Attribute (quoted) Value';
    case 'attributeEscaped': return 'Tag Attribute (encoded)';
    case 'jsonEscaped': return 'Script (JSON block, \\uXXXX)';
    case 'html': return 'HTML';
    case 'htmlComment': return 'HTML Comment';
    case 'responseHeader': return 'Response Header';
    default: return canonical;
  }
}
