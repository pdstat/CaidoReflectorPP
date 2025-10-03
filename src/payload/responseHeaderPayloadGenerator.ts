// Context-aware payload generation & detection for response header reflections.
// Mirrors the philosophy of body reflection probing but simplified for headers.
import { randomValue } from "../utils/text.ts"


export interface HeaderProbeMarker { ch: string; pre: string; suf: string; needle: string; }
export interface HeaderProbePlan { markers: HeaderProbeMarker[]; injectedValue: string; }
export interface HeaderDetectionResult { allowedChars: string[]; crlfInjection: boolean; }

// Character sets per interesting header. Focus on characters that, if reflected literally,
// expand exploit surface (injection, response splitting, policy relaxation, open redirect, etc.).
const HEADER_CHARSETS: Record<string, string[]> = {
  'location': [':', '/', '?', '#', '&', '=', '%', ' ', '<', '"', '\'', '\\'],
  'set-cookie': [';', ',', '=', ' ', '"', '\''],
  'content-security-policy': [';', ',', '\'', ' ', '*', ':', '/', '.', '(', ')'],
  'access-control-allow-origin': ['*', ' ', '/', ':', '.', '-', '_'],
  'access-control-allow-credentials': ['t', 'r', 'u', 'e'], // limited; mainly detect full literal echo
  'content-type': [';', ' ', '=', '/', '+', '-'],
  'refresh': [';', '=', ' ', ':', '/', '?', '#'],
  'content-disposition': [';', ' ', '=', '"', '\'', '*']
};

// Universal chars always tested for all headers (newline & carriage return for response splitting attempts)
const UNIVERSAL = ['\n', '\r'];

export class ResponseHeaderPayloadGenerator {
  static buildPlan(headerNames: string[], extraChars: string[] = []): HeaderProbePlan {
    const needed = new Set<string>();
    for (const h of headerNames) {
      const cs = HEADER_CHARSETS[h.toLowerCase()];
      if (cs) cs.forEach(c => needed.add(c));
    }
    UNIVERSAL.forEach(c => needed.add(c));
    extraChars.forEach(c => needed.add(c));
    // Deterministic order
    const chars = Array.from(needed.values());
    const markers: HeaderProbeMarker[] = chars.map(ch => {
      const pre = randomValue();
      const suf = randomValue();
      // For readability; we inject the raw character including potential control chars.
      const needle = pre + encodeURIComponent(ch) + suf; // encode in request value to survive transport
      return { ch, pre, suf, needle };
    });
    const injectedValue = markers.map(m => m.needle).join('');
    return { markers, injectedValue };
  }

  static detect(headers: Record<string, string | string[]>, markers: HeaderProbeMarker[]): HeaderDetectionResult {
    const allowed = new Set<string>();
    let crlf = false;
    // Normalize header values to array of raw strings
    const norm: Array<string> = [];
    for (const v of Object.values(headers)) {
      if (Array.isArray(v)) v.forEach(x => typeof x === 'string' && norm.push(x)); else if (typeof v === 'string') norm.push(v);
    }
    const joined = norm.join('\n');
    const lowerJoined = joined.toLowerCase();
    for (const m of markers) {
      // We encoded character part with encodeURIComponent(ch); reconstruct the literal pattern:
      // For detection we look for pre + decoded(ch) + suf literally; also fallback to encoded for defensive cases.
      const literalNeedle = m.pre + m.ch + m.suf;
      if (joined.includes(literalNeedle)) {
        allowed.add(m.ch === '\n' ? '\n' : m.ch === '\r' ? '\r' : m.ch);
        if (m.ch === '\n' || m.ch === '\r') crlf = true;
        continue;
      }
      // Check case-insensitive for alphabetic chars that might have transformed case
      if (/^[a-z]$/i.test(m.ch)) {
        const alt = m.pre + m.ch.toLowerCase() + m.suf;
        if (lowerJoined.includes(alt.toLowerCase())) allowed.add(m.ch.toLowerCase());
      }
    }
    return { allowedChars: Array.from(allowed.values()), crlfInjection: crlf };
  }
}
