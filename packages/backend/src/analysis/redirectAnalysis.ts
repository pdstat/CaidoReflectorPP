import type { RedirectPosition, SeverityTier } from '../core/types.js';

const SUBDOMAIN_BREAKOUT_CHARS = ['?', '/', '#', '\\'];

export function getSubdomainBreakoutChars(
  allowedChars: string[]
): string[] {
  return allowedChars.filter(c => SUBDOMAIN_BREAKOUT_CHARS.includes(c));
}

function extractUrl(headerValue: string, headerName: string): string {
  if (headerName.toLowerCase() === 'refresh') {
    const match = headerValue.match(/;\s*url\s*=\s*/i);
    if (match?.index != null) {
      return headerValue.substring(match.index + match[0].length);
    }
  }
  return headerValue;
}

export function detectRedirectPosition(
  headerValue: string,
  paramValue: string,
  headerName: string
): RedirectPosition {
  if (!paramValue || !headerValue) return 'unknown';

  const url = extractUrl(headerValue, headerName);
  const valueLower = paramValue.toLowerCase();
  const urlLower = url.toLowerCase();

  const idx = urlLower.indexOf(valueLower);
  if (idx === -1) return 'unknown';

  const prefix = url.substring(0, idx);
  const suffix = url.substring(idx + paramValue.length);

  if (!prefix.trim()) {
    if (suffix.startsWith('://')) return 'scheme';
    return 'full-url';
  }

  const schemeMatch = prefix.match(/^(https?:)?\/\//i);
  if (schemeMatch) {
    return classifyAuthorityOrPath(
      prefix.substring(schemeMatch[0].length), suffix
    );
  }

  if (prefix.startsWith('/')) {
    if (prefix.includes('#')) return 'fragment';
    if (prefix.includes('?')) return 'query';
    return 'path';
  }

  if (prefix.includes('#')) return 'fragment';
  if (prefix.includes('?')) return 'query';
  return 'unknown';
}

function classifyAuthorityOrPath(
  afterAuth: string,
  suffix: string
): RedirectPosition {
  if (!afterAuth) {
    if (/^\.[a-z0-9]/i.test(suffix)) return 'subdomain';
    return 'host';
  }

  if (afterAuth.endsWith('@')) {
    if (/^\.[a-z0-9]/i.test(suffix)) return 'subdomain';
    return 'host';
  }

  if (!afterAuth.includes('/')) {
    if (afterAuth.endsWith(':')) return 'unknown';
    return 'subdomain';
  }

  if (afterAuth.includes('#')) return 'fragment';
  if (afterAuth.includes('?')) return 'query';
  return 'path';
}

export function classifyRedirectSeverity(
  position: RedirectPosition | undefined,
  allowedChars: string[]
): SeverityTier {
  switch (position) {
    case 'full-url':
    case 'host':
    case 'scheme':
      return 'high';
    case 'subdomain':
      if (getSubdomainBreakoutChars(allowedChars).length > 0) return 'high';
      return 'medium';
    case 'path':
      return 'medium';
    case 'query':
    case 'fragment':
      return 'low';
    case 'unknown':
    default:
      if (allowedChars.includes('/') || allowedChars.includes(':')) {
        return 'high';
      }
      return 'medium';
  }
}
