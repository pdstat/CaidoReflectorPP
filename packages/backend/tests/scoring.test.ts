import { classifySeverity } from "../src/analysis/scoring.js";

describe("classifySeverity", () => {
  test("unconfirmed always returns info", () => {
    expect(classifySeverity({
      confirmed: false, allowedChars: ['<', '"'], context: 'js'
    })).toBe('info');
  });

  test("confirmed script string with quote breakout is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['"'], context: 'jsInQuote'
    })).toBe('critical');
  });

  test("confirmed script string with < is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'jsInQuote'
    })).toBe('critical');
  });

  test("confirmed script (non-string) with < is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'js'
    })).toBe('critical');
  });

  test("confirmed event handler with any char is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [')'], context: 'eventHandler'
    })).toBe('critical');
  });

  test("confirmed script without breakout is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'js'
    })).toBe('high');
  });

  test("confirmed script string without breakout is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['>'], context: 'jsInQuote'
    })).toBe('high');
  });

  test("confirmed event handler without chars is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'eventHandler'
    })).toBe('high');
  });

  test("confirmed quoted attribute with quote is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['"'], context: 'attributeInQuote'
    })).toBe('high');
  });

  test("confirmed Location header is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [],
      context: 'Response Header', header: true,
      headerNames: ['Location']
    })).toBe('high');
  });

  test("confirmed Set-Cookie header is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [],
      context: 'Response Header', header: true,
      headerNames: ['Set-Cookie']
    })).toBe('high');
  });

  test("confirmed CSP header is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [],
      context: 'Response Header', header: true,
      headerNames: ['Content-Security-Policy']
    })).toBe('high');
  });

  test("confirmed HTML with < is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'html'
    })).toBe('medium');
  });

  test("confirmed CSS is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'css'
    })).toBe('medium');
  });

  test("confirmed CSS in quote is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'cssInQuote'
    })).toBe('medium');
  });

  test("confirmed unquoted attribute is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [' '], context: 'attribute'
    })).toBe('medium');
  });

  test("confirmed JSON structure is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'jsonStructure'
    })).toBe('medium');
  });

  test("confirmed CORS header (other header) is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [],
      context: 'Response Header', header: true,
      headerNames: ['Access-Control-Allow-Origin']
    })).toBe('medium');
  });

  test("confirmed custom header is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [],
      context: 'Response Header', header: true,
      headerNames: ['X-Custom']
    })).toBe('medium');
  });

  test("confirmed HTML without < is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['>'], context: 'html'
    })).toBe('low');
  });

  test("confirmed HTML comment is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'htmlComment'
    })).toBe('low');
  });

  test("confirmed escaped attribute is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'attributeEscaped'
    })).toBe('low');
  });

  test("confirmed escaped event handler is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'eventHandlerEscaped'
    })).toBe('low');
  });

  test("confirmed JSON escaped is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'jsonEscaped'
    })).toBe('low');
  });

  test("confirmed quoted attribute without quote breakout is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['>'], context: 'attributeInQuote'
    })).toBe('low');
  });

  test("confirmed JSON string is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'jsonString'
    })).toBe('low');
  });

  test("legacy alias 'Script' maps to js context", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'Script'
    })).toBe('critical');
  });

  test("legacy alias 'Script String' maps to jsInQuote", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['"', '<'], context: 'Script String'
    })).toBe('critical');
  });

  test("unknown context defaults to low when confirmed", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'unknownCtx'
    })).toBe('low');
  });
});
