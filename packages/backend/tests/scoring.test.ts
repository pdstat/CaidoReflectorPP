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

  test("single quote in double-quoted JS string is not critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ["'"], context: 'Script String (")'
    })).toBe('low');
  });

  test("double quote in single-quoted JS string is not critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['"'], context: "Script String (')"
    })).toBe('low');
  });

  test("matching quote in double-quoted JS string is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['"'], context: 'Script String (")'
    })).toBe('critical');
  });

  test("matching quote in single-quoted JS string is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ["'"], context: "Script String (')"
    })).toBe('critical');
  });

  test("non-matching quote in double-quoted attr is not high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ["'"], context: 'Tag Attribute (") Value'
    })).toBe('low');
  });

  test("matching quote in double-quoted attr is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['"'], context: 'Tag Attribute (") Value'
    })).toBe('high');
  });

  test("confirmed script string with < and / is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<', '/'], context: 'jsInQuote'
    })).toBe('critical');
  });

  test("confirmed script string with < alone is high (no / for </script>)", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'jsInQuote'
    })).toBe('high');
  });

  test("confirmed script (non-string) with < and / is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<', '/'], context: 'js'
    })).toBe('critical');
  });

  test("confirmed script (non-string) with < alone is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'js'
    })).toBe('high');
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

  test("confirmed script string without string-escape chars is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['>'], context: 'jsInQuote'
    })).toBe('low');
  });

  test("confirmed script string with backslash is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['\\'], context: 'jsInQuote'
    })).toBe('high');
  });

  test("confirmed script string with backtick is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['`'], context: 'jsInQuote'
    })).toBe('high');
  });

  test("confirmed script string with only parens/star is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['(', ')', '*'], context: 'jsInQuote'
    })).toBe('low');
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

  test("Location header with redirect chars is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['/'],
      context: 'Response Header', header: true,
      headerNames: ['Location']
    })).toBe('high');
  });

  test("Location header with : is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [':'],
      context: 'Response Header', header: true,
      headerNames: ['Location']
    })).toBe('high');
  });

  test("Location header without redirect chars is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ["'"],
      context: 'Response Header', header: true,
      headerNames: ['Location']
    })).toBe('medium');
  });

  test("Set-Cookie header with ; is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [';'],
      context: 'Response Header', header: true,
      headerNames: ['Set-Cookie']
    })).toBe('high');
  });

  test("Set-Cookie header without ; is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['='],
      context: 'Response Header', header: true,
      headerNames: ['Set-Cookie']
    })).toBe('medium');
  });

  test("CSP header with ' is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ["'"],
      context: 'Response Header', header: true,
      headerNames: ['Content-Security-Policy']
    })).toBe('high');
  });

  test("CSP header with * is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['*'],
      context: 'Response Header', header: true,
      headerNames: ['Content-Security-Policy']
    })).toBe('high');
  });

  test("CSP header without bypass chars is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [':'],
      context: 'Response Header', header: true,
      headerNames: ['Content-Security-Policy']
    })).toBe('medium');
  });

  test("Refresh header with / is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['/'],
      context: 'Response Header', header: true,
      headerNames: ['Refresh']
    })).toBe('high');
  });

  test("Refresh header without redirect chars is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['='],
      context: 'Response Header', header: true,
      headerNames: ['Refresh']
    })).toBe('medium');
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
      confirmed: true, allowedChars: ['<', '/'], context: 'Script'
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

  // Feature 1: RAWTEXT/RCDATA
  test("confirmed rawtextElement with closing tag + < is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['</textarea>', '<'], context: 'rawtextElement'
    })).toBe('medium');
  });

  test("confirmed rawtextElement without closing tag is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['>'], context: 'rawtextElement'
    })).toBe('low');
  });

  // Feature 2: javascript: URI
  test("confirmed jsUri is always critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'jsUri'
    })).toBe('critical');
  });

  test("confirmed jsUri with chars is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['(', ')'], context: 'jsUri'
    })).toBe('critical');
  });

  // Feature 3: SVG/MathML
  test("confirmed svgContext with < is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'svgContext'
    })).toBe('medium');
  });

  test("confirmed mathContext with < is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'mathContext'
    })).toBe('medium');
  });

  test("confirmed svgContext without < is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['>'], context: 'svgContext'
    })).toBe('low');
  });

  // Feature 4: JS template literals
  test("confirmed jsTemplateLiteral with $ and { is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['$', '{'], context: 'jsTemplateLiteral'
    })).toBe('critical');
  });

  test("confirmed jsTemplateLiteral with backtick is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['`'], context: 'jsTemplateLiteral'
    })).toBe('critical');
  });

  test("confirmed jsTemplateLiteral with < and / is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<', '/'], context: 'jsTemplateLiteral'
    })).toBe('critical');
  });

  test("confirmed jsTemplateLiteral with < alone is low (no / for </script>)", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'jsTemplateLiteral'
    })).toBe('low');
  });

  test("confirmed jsTemplateLiteral with backslash is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['\\'], context: 'jsTemplateLiteral'
    })).toBe('high');
  });

  test("confirmed jsTemplateLiteral without escape chars is low", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['>'], context: 'jsTemplateLiteral'
    })).toBe('low');
  });

  // Feature 5: base tag injection
  test("confirmed htmlBaseInjection with < is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'htmlBaseInjection'
    })).toBe('high');
  });

  test("pretty-printed HTML (Base Tag Injection) with < resolves to high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<'], context: 'HTML (Base Tag Injection)'
    })).toBe('high');
  });

  test("confirmed htmlBaseInjection without < is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['>'], context: 'htmlBaseInjection'
    })).toBe('medium');
  });

  // Feature 6: DOM clobbering
  test("confirmed domClobber is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'domClobber'
    })).toBe('medium');
  });

  // Feature 7: CRLF response splitting
  test("confirmed responseSplitting is critical", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['\r', '\n'], context: 'responseSplitting'
    })).toBe('critical');
  });

  // Feature 8: import maps
  test("confirmed importMap is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'importMap'
    })).toBe('high');
  });

  test("confirmed importMapString is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['"'], context: 'importMapString'
    })).toBe('high');
  });

  // Feature 9: data: URI
  test("confirmed dataUri with chars is high", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: ['<', '>'], context: 'dataUri'
    })).toBe('high');
  });

  test("confirmed dataUri without chars is medium", () => {
    expect(classifySeverity({
      confirmed: true, allowedChars: [], context: 'dataUri'
    })).toBe('medium');
  });
});
