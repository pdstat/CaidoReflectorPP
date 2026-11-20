import { CONTEXT, toCanonical } from './contextMap.js';
import type { SeverityTier, RedirectPosition } from '../core/types.js';
import { classifyRedirectSeverity } from './redirectAnalysis.js';

export type { SeverityTier };

export interface SeverityInputs {
  confirmed: boolean;
  context: string;
  allowedChars: string[];
  header?: boolean;
  headerNames?: string[];
  redirectPosition?: RedirectPosition;
}

const SCRIPT_CONTEXTS = new Set<string>([
  CONTEXT.JS, CONTEXT.JS_IN_QUOTE
]);

const CSS_CONTEXTS = new Set<string>([
  CONTEXT.CSS, CONTEXT.CSS_IN_QUOTE
]);

function enclosingQuote(context: string): string | undefined {
  if (context.includes("(')")) return "'";
  if (context.includes('(")')) return '"';
  return undefined;
}

function hasQuoteBreakout(chars: string[], context?: string): boolean {
  if (context) {
    const quote = enclosingQuote(context);
    if (quote) return chars.includes(quote);
  }
  return chars.includes('"') || chars.includes("'");
}

function hasStringEscape(chars: string[], context?: string): boolean {
  if (hasQuoteBreakout(chars, context)) return true;
  if (chars.includes('\\')) return true;
  if (hasTagEscape(chars)) return true;
  if (chars.includes('`')) {
    const quote = context ? enclosingQuote(context) : undefined;
    if (!quote) return true;
  }
  return false;
}

function hasCookieInjectionChars(chars: string[]): boolean {
  return chars.includes(';');
}

function hasCSPBypassChars(chars: string[]): boolean {
  return chars.includes(';') || chars.includes("'") || chars.includes('*');
}

function hasTagEscape(chars: string[]): boolean {
  return chars.includes('<');
}

function hasScriptTagEscape(chars: string[]): boolean {
  return chars.includes('<') && chars.includes('/');
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
    if (hasExpressionHole(chars) || chars.includes('`')
        || hasScriptTagEscape(chars)) {
      return 'critical';
    }
  }
  if (SCRIPT_CONTEXTS.has(canonical)) {
    const isString = canonical === CONTEXT.JS_IN_QUOTE;
    if (isString && (hasQuoteBreakout(chars, inp.context)
        || hasScriptTagEscape(chars))) {
      return 'critical';
    }
    if (!isString && hasScriptTagEscape(chars)) return 'critical';
  }
  if (canonical === CONTEXT.EVENT_HANDLER && chars.length > 0) {
    return 'critical';
  }
  if ((canonical === CONTEXT.JSON_STRING || canonical === CONTEXT.JSON_STRUCTURE)
      && hasScriptTagEscape(chars)) {
    return 'critical';
  }

  // High tier
  if (canonical === CONTEXT.JS_TEMPLATE_LITERAL) {
    if (chars.includes('\\')) return 'high';
    return 'low';
  }
  if (canonical === CONTEXT.JS_IN_QUOTE) {
    if (hasStringEscape(chars, inp.context)) return 'high';
    return 'low';
  }
  if (canonical === CONTEXT.JS) return 'high';
  if (canonical === CONTEXT.EVENT_HANDLER) return 'high';
  if (canonical === CONTEXT.ATTRIBUTE_IN_QUOTE && hasQuoteBreakout(chars, inp.context)) {
    return 'high';
  }
  if (canonical === CONTEXT.IMPORT_MAP || canonical === CONTEXT.IMPORT_MAP_STRING) {
    return 'high';
  }
  if (canonical === CONTEXT.DATA_URI && chars.length > 0) return 'high';
  if ((canonical === CONTEXT.JSON_STRING || canonical === CONTEXT.JSON_STRUCTURE)
      && hasTagEscape(chars)) {
    return 'high';
  }
  if (canonical === CONTEXT.HTML_BASE_INJECTION && hasTagEscape(chars)) {
    return 'high';
  }
  // Raw "<" in a context where it can open a new tag is a working reflected XSS:
  // directly, by borrowing a downstream ">" the page already contains, or as
  // dangling-markup data exfiltration. All high regardless of whether ">" also
  // reflects. Rawtext/attribute/CSS contexts, where "<" cannot open a tag, stay
  // in the medium tier below.
  if ((canonical === CONTEXT.HTML
      || canonical === CONTEXT.SVG_CONTEXT
      || canonical === CONTEXT.MATH_CONTEXT)
      && hasTagEscape(chars)) {
    return 'high';
  }
  // Inside an HTML comment "<" is inert until the comment is closed, so a working XSS
  // needs to close the comment ("-->") AND open a tag: "-", ">" and "<" must all reflect.
  if (canonical === CONTEXT.HTML_COMMENT
      && chars.includes('<') && chars.includes('>') && chars.includes('-')) {
    return 'high';
  }
  // CSS that can write "</style><script>" (raw "<" and "/") is a real reflected XSS,
  // not just style injection.
  if (CSS_CONTEXTS.has(canonical) && hasScriptTagEscape(chars)) {
    return 'high';
  }
  // Unquoted attribute value: a raw space injects a new attribute (e.g. onfocus= autofocus)
  // and a raw ">" breaks out of the tag entirely -- both are handler/tag-injection XSS.
  if (canonical === CONTEXT.ATTRIBUTE
      && (chars.includes(' ') || chars.includes('>'))) {
    return 'high';
  }
  if (inp.header) {
    const names = new Set(
      inp.headerNames?.map(h => h.toLowerCase()) ?? []
    );
    if (names.has('location') || names.has('refresh')) {
      return classifyRedirectSeverity(inp.redirectPosition, chars);
    }
    if (names.has('set-cookie')
        && hasCookieInjectionChars(chars)) return 'high';
    if (names.has('content-security-policy')
        && hasCSPBypassChars(chars)) return 'high';
  }

  // Medium tier
  if (canonical === CONTEXT.RAWTEXT_ELEMENT) {
    if (hasClosingTagBreakout(chars) && hasTagEscape(chars)) return 'medium';
  }
  if (canonical === CONTEXT.HTML_BASE_INJECTION) return 'medium';
  if (CSS_CONTEXTS.has(canonical)) return 'medium';
  if (canonical === CONTEXT.ATTRIBUTE) return 'medium';
  if (canonical === CONTEXT.JSON_STRUCTURE) return 'medium';
  if (canonical === CONTEXT.DATA_URI) return 'medium';
  if (canonical === CONTEXT.DOM_CLOBBER) return 'medium';
  if (inp.header) return 'medium';

  return 'low';
}
