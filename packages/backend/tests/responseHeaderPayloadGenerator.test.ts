import { ResponseHeaderPayloadGenerator } from "../src/payload/responseHeaderPayloadGenerator.ts";

describe("ResponseHeaderPayloadGenerator.buildPlan", () => {
  test("single header (Location) includes expected chars + CRLF with no duplicates", () => {
    const plan = ResponseHeaderPayloadGenerator.buildPlan(["Location"]);
    // Expected base chars for Location header (from implementation) + universal CR/LF
    const expected = new Set([':', '/', '?', '#', '&', '=', '%', ' ', '<', '"', '\'', '\\', '\n', '\r']);
    const chars = plan.markers.map(m => m.ch === '\n' ? '\n' : m.ch === '\r' ? '\r' : m.ch);
    // All expected present
    for (const ch of expected) {
      expect(chars).toContain(ch);
    }
    // No duplicate characters
    expect(new Set(chars).size).toBe(chars.length);
    // injectedValue is concatenation of all marker needles in order
    const concatenated = plan.markers.map(m => m.needle).join("");
    expect(plan.injectedValue).toBe(concatenated);
    // Each marker needle should wrap an encoded char (encodeURIComponent) between random pre/suf
    for (const m of plan.markers) {
      // Basic shape: pre + encoded(ch) + suf
      expect(m.needle.startsWith(m.pre)).toBe(true);
      expect(m.needle.endsWith(m.suf)).toBe(true);
      const inner = m.needle.slice(m.pre.length, m.needle.length - m.suf.length);
      expect(inner.length).toBeGreaterThan(0); // encoded char length may vary
    }
  });

  test("multiple headers merge charsets & extraChars deduped", () => {
    const plan = ResponseHeaderPayloadGenerator.buildPlan(["Location", "Set-Cookie"], ['X', ';']);
    const chars = new Set(plan.markers.map(m => m.ch));
    // From Location + Set-Cookie we expect semicolon, comma, etc.
    [';', ',', ':', '/', '?', '#', '&', '=', '%', ' ', '<', '"', '\'', '\\', 'X', '\n', '\r'].forEach(ch => {
      expect(chars.has(ch)).toBe(true);
    });
    // Ensure only one semicolon (dedup)
    expect(plan.markers.filter(m => m.ch === ';').length).toBe(1);
    // Ensure extra char X present exactly once
    expect(plan.markers.filter(m => m.ch === 'X').length).toBe(1);
  });
});

describe("ResponseHeaderPayloadGenerator.detect", () => {
  test("detects reflected chars including CRLF and sets crlfInjection flag", () => {
    const plan = ResponseHeaderPayloadGenerator.buildPlan(["Location"], []);
    // Pick a subset of markers to simulate reflection: newline, carriage return, and ':'
    const nl = plan.markers.find(m => m.ch === '\n');
    const cr = plan.markers.find(m => m.ch === '\r');
    const colon = plan.markers.find(m => m.ch === ':');
    expect(nl && cr && colon).toBeTruthy();
    // Server reflected decoded characters, so construct literal needles using pre + ch + suf
    const headerValue = [nl!, cr!, colon!]
      .map(m => m.pre + m.ch + m.suf)
      .join('');
    const headers = { 'location': headerValue } as Record<string, string>;
    const result = ResponseHeaderPayloadGenerator.detect(headers, plan.markers);
    const allowed = new Set(result.allowedChars);
    expect(allowed.has('\n')).toBe(true);
    expect(allowed.has('\r')).toBe(true);
    expect(allowed.has(':')).toBe(true);
    expect(result.crlfInjection).toBe(true);
  });

  test("case-insensitive alphabetic detection when reflected char changes case", () => {
    const plan = ResponseHeaderPayloadGenerator.buildPlan(["Access-Control-Allow-Credentials"], []);
    // Choose one alphabetic marker, e.g., 't'
    const markerT = plan.markers.find(m => m.ch === 't');
    expect(markerT).toBeTruthy();
    // Simulate server reflecting uppercase 'T' instead of lowercase
    const headerValue = markerT!.pre + 'T' + markerT!.suf;
    const headers = { 'access-control-allow-credentials': headerValue } as Record<string, string>;
    const result = ResponseHeaderPayloadGenerator.detect(headers, plan.markers);
    expect(result.allowedChars).toContain('t');
    // crlfInjection should be false here (no newline / carriage return reflected)
    expect(result.crlfInjection).toBe(false);
  });
});
