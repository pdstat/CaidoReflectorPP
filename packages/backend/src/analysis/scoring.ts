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
  allowCredentials?: boolean;
  // The reflection is in a standalone JavaScript response (application/javascript,
  // text/javascript, ...), not inline in an HTML <script>. The browser parses it as
  // script, never as HTML, so a "</script>" tag-escape cannot break out -- those
  // critical paths are suppressed. A JS-string quote breakout is still live code
  // execution and stays critical.
  isJsResponse?: boolean;
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

// A raw "<" escapes a JS string only via "</script>" in an inline script; in a standalone
// JS response the browser never parses HTML, so it is inert there.
function hasStringEscape(chars: string[], context?: string, isJsResponse?: boolean): boolean {
  if (hasQuoteBreakout(chars, context)) return true;
  if (chars.includes('\\')) return true;
  if (hasTagEscape(chars) && !isJsResponse) return true;
  if (chars.includes('`')) {
    const quote = context ? enclosingQuote(context) : undefined;
    if (!quote) return true;
  }
  return false;
}

function hasCookieInjectionChars(chars: string[]): boolean {
  // ';' adds a cookie attribute; CR/LF splits the header. A cookie value cannot
  // carry ';' (it is the cookie delimiter), so a cookie echoed into Set-Cookie
  // never matches here -- correctly, since it is not injectable.
  return chars.includes(';') || chars.includes('\r') || chars.includes('\n');
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
  const tagEscapeCritical = hasScriptTagEscape(chars) && !inp.isJsResponse;
  if (canonical === CONTEXT.JS_TEMPLATE_LITERAL) {
    if (hasExpressionHole(chars) || chars.includes('`') || tagEscapeCritical) {
      return 'critical';
    }
  }
  if (SCRIPT_CONTEXTS.has(canonical)) {
    const isString = canonical === CONTEXT.JS_IN_QUOTE;
    if (isString && (hasQuoteBreakout(chars, inp.context) || tagEscapeCritical)) {
      return 'critical';
    }
    if (!isString && tagEscapeCritical) return 'critical';
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
    if (hasStringEscape(chars, inp.context, inp.isJsResponse)) return 'high';
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
    // A Set-Cookie reflection is an injection only when a real breakout char
    // survives (';' adds an attribute, CR/LF splits the header). Any other char
    // -- notably a bare "'" -- is inert in a cookie value, so it is a low-severity
    // reflection, not an injection. A cookie-sourced value echoed back into
    // Set-Cookie lands here at low, since ';' cannot pass through a cookie value.
    if (names.has('set-cookie')) {
      return hasCookieInjectionChars(chars) ? 'high' : 'low';
    }
    // A CSP reflection is security-relevant: a bypass char (';', space, "'", '*', ':', '/')
    // lets an attacker weaken the policy -> high; otherwise it still warrants medium.
    if (names.has('content-security-policy')) {
      return hasCSPBypassChars(chars) ? 'high' : 'medium';
    }
    // A reflected Access-Control-Allow-Origin combined with Allow-Credentials: true
    // exposes authenticated data to an attacker-chosen origin -> critical. Without
    // credentials, the attacker can read only what any unauthenticated cross-origin
    // request already can, so the misconfiguration is low severity, not high.
    if (names.has('access-control-allow-origin')) {
      return inp.allowCredentials ? 'critical' : 'low';
    }
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
  // Generic (non-security) response headers: Location/Refresh/Set-Cookie/CSP/ACAO are scored
  // in their own branches above. Any other header (Timing-Allow-Origin, Nexturl,
  // Access-Control-Allow-Headers, vendor X-* headers, ...) is not an XSS or injection vector
  // on its own -- response splitting via CR/LF is handled separately as its own context -- so
  // a value echoed there is a low-severity reflection, not a medium one.
  if (inp.header) return 'low';

  return 'low';
}
