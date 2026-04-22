import { CONTEXT, toCanonical } from './contextMap.js';
import type { SeverityTier } from '../core/types.js';

export type { SeverityTier };

export interface SeverityInputs {
  confirmed: boolean;
  context: string;
  allowedChars: string[];
  header?: boolean;
  headerNames?: string[];
}

const HIGH_IMPACT_HEADERS = new Set([
  'location', 'refresh', 'set-cookie', 'content-security-policy'
]);

const SCRIPT_CONTEXTS = new Set<string>([
  CONTEXT.JS, CONTEXT.JS_IN_QUOTE
]);

const CSS_CONTEXTS = new Set<string>([
  CONTEXT.CSS, CONTEXT.CSS_IN_QUOTE
]);

function hasQuoteBreakout(chars: string[]): boolean {
  return chars.includes('"') || chars.includes("'");
}

function hasTagEscape(chars: string[]): boolean {
  return chars.includes('<');
}

function hasClosingTagBreakout(chars: string[]): boolean {
  return chars.some(c => /^<\/[a-z]+>$/i.test(c));
}

function hasExpressionHole(chars: string[]): boolean {
  return chars.includes('$') && chars.includes('{');
}

export function classifySeverity(inp: SeverityInputs): SeverityTier {
  if (!inp.confirmed) return 'info';

  const chars = inp.allowedChars;
  const canonical = toCanonical(inp.context) ?? inp.context;

  // Critical tier
  if (canonical === CONTEXT.RESPONSE_SPLITTING) return 'critical';
  if (canonical === CONTEXT.JS_URI) return 'critical';
  if (canonical === CONTEXT.JS_TEMPLATE_LITERAL) {
    if (hasExpressionHole(chars) || chars.includes('`') || hasTagEscape(chars)) {
      return 'critical';
    }
  }
  if (SCRIPT_CONTEXTS.has(canonical)) {
    const isString = canonical === CONTEXT.JS_IN_QUOTE;
    if (isString && (hasQuoteBreakout(chars) || hasTagEscape(chars))) {
      return 'critical';
    }
    if (!isString && hasTagEscape(chars)) return 'critical';
  }
  if (canonical === CONTEXT.EVENT_HANDLER && chars.length > 0) {
    return 'critical';
  }

  // High tier
  if (canonical === CONTEXT.JS_TEMPLATE_LITERAL) return 'high';
  if (SCRIPT_CONTEXTS.has(canonical)) return 'high';
  if (canonical === CONTEXT.EVENT_HANDLER) return 'high';
  if (canonical === CONTEXT.ATTRIBUTE_IN_QUOTE && hasQuoteBreakout(chars)) {
    return 'high';
  }
  if (canonical === CONTEXT.IMPORT_MAP || canonical === CONTEXT.IMPORT_MAP_STRING) {
    return 'high';
  }
  if (canonical === CONTEXT.DATA_URI && chars.length > 0) return 'high';
  if (canonical === CONTEXT.HTML_BASE_INJECTION && hasTagEscape(chars)) {
    return 'high';
  }
  if (inp.header) {
    const hasHighImpact = inp.headerNames?.some(
      h => HIGH_IMPACT_HEADERS.has(h.toLowerCase())
    );
    if (hasHighImpact) return 'high';
  }

  // Medium tier
  if (canonical === CONTEXT.RAWTEXT_ELEMENT) {
    if (hasClosingTagBreakout(chars) && hasTagEscape(chars)) return 'medium';
  }
  if (canonical === CONTEXT.SVG_CONTEXT && hasTagEscape(chars)) return 'medium';
  if (canonical === CONTEXT.MATH_CONTEXT && hasTagEscape(chars)) return 'medium';
  if (canonical === CONTEXT.HTML && hasTagEscape(chars)) return 'medium';
  if (canonical === CONTEXT.HTML_BASE_INJECTION) return 'medium';
  if (CSS_CONTEXTS.has(canonical)) return 'medium';
  if (canonical === CONTEXT.ATTRIBUTE) return 'medium';
  if (canonical === CONTEXT.JSON_STRUCTURE) return 'medium';
  if (canonical === CONTEXT.DATA_URI) return 'medium';
  if (canonical === CONTEXT.DOM_CLOBBER) return 'medium';
  if (inp.header) return 'medium';

  return 'low';
}
