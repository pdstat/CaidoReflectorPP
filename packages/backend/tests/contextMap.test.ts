import { toCanonical, isEscapedCanonical, prettyPrintContext } from "../src/analysis/contextMap.js";

describe("contextMap.toCanonical", () => {
  const cases: Array<[string, string]> = [
    ["js", "js"],
    ["JS", "js"],
    ["script", "js"],
    ["Script", "js"],
    ["script string", "jsInQuote"],
    ["Script String", "jsInQuote"],
    ["style", "css"],
    ["STYLE", "css"],
    ["style string", "cssInQuote"],
    ["Style String", "cssInQuote"],
    ["Response Header", "responseHeader"],
    ["Tag Attribute (\") Value", "attributeInQuote"],
    ["tag attribute (') value", "attributeInQuote"],
    ["attributeEscaped", "attributeEscaped"],
    ["eventHandlerEscaped", "eventHandlerEscaped"],
    ["jsonEscaped", "jsonEscaped"],
    ["HTML", "html"],
    ["html comment", "htmlComment"],
    ["json string", "jsonString"],
    ["JSON Structure", "jsonStructure"],
  ];
  test.each(cases)("%s → %s", (input, expected) => {
    expect(toCanonical(input)).toBe(expected);
  });

  const resolutionCases: Array<[string, string]> = [
    ['Script String (")', "jsInQuote"],
    ['Style String (")', "cssInQuote"],
    ["Event Handler Attribute (quoted)", "eventHandler"],
    ["Event Handler Attribute (unquoted)", "eventHandler"],
    ["Event Handler Attribute", "eventHandler"],
    ["URL Attribute (quoted)", "attributeInQuote"],
    ["URL Attribute (unquoted)", "attribute"],
    ["CSS url()", "css"],
    ["Style Attribute (quoted)", "cssInQuote"],
    ["Style Attribute (unquoted)", "css"],
    ["Srcset Attribute (quoted)", "attributeInQuote"],
    ["Meta Refresh URL", "attributeInQuote"],
    ["Iframe Srcdoc (quoted)", "html"],
    ["Template HTML", "html"],
    ["JSON Script Block (string)", "jsonString"],
    ["JSON Script Block", "jsonStructure"],
    ["Tag Attribute (quoted) Value", "attributeInQuote"],
    ["Tag Attribute (unquoted) Value", "attribute"],
    ["Tag Attribute (encoded)", "attributeEscaped"],
  ];
  test.each(resolutionCases)("contextResolution: %s → %s", (input, expected) => {
    expect(toCanonical(input)).toBe(expected);
  });

  const newContextCases: Array<[string, string]> = [
    ["rawtextElement", "rawtextElement"],
    ["RAWTEXT/RCDATA Element", "rawtextElement"],
    ["jsUri", "jsUri"],
    ["JavaScript URI", "jsUri"],
    ["javascript: uri", "jsUri"],
    ["dataUri", "dataUri"],
    ["Data URI", "dataUri"],
    ["data: uri", "dataUri"],
    ["svgContext", "svgContext"],
    ["SVG Context", "svgContext"],
    ["mathContext", "mathContext"],
    ["MathML Context", "mathContext"],
    ["jsTemplateLiteral", "jsTemplateLiteral"],
    ["JS Template Literal", "jsTemplateLiteral"],
    ["template literal", "jsTemplateLiteral"],
    ["htmlBaseInjection", "htmlBaseInjection"],
    ["HTML (Base Tag Injection)", "htmlBaseInjection"],
    ["base injection", "htmlBaseInjection"],
    ["domClobber", "domClobber"],
    ["DOM Clobbering (id/name)", "domClobber"],
    ["importMap", "importMap"],
    ["Import Map", "importMap"],
    ["importMapString", "importMapString"],
    ["Import Map String", "importMapString"],
    ["responseSplitting", "responseSplitting"],
    ["Response Splitting (CRLF)", "responseSplitting"],
  ];
  test.each(newContextCases)("new context: %s → %s", (input, expected) => {
    expect(toCanonical(input)).toBe(expected);
  });

  const internalCases: Array<[string, string]> = [
    ["eventHandlerAttrInQuote", "eventHandler"],
    ["eventHandlerAttr", "eventHandler"],
    ["srcsetUrl", "attribute"],
    ["srcsetUrlInQuote", "attributeInQuote"],
    ["urlAttr", "attribute"],
    ["urlAttrInQuote", "attributeInQuote"],
    ["cssUrl", "css"],
    ["styleAttr", "css"],
    ["styleAttrInQuote", "cssInQuote"],
    ["metaRefresh", "attributeInQuote"],
    ["srcdocHtmlInQuote", "html"],
    ["srcdocHtml", "html"],
    ["templateHtml", "html"],
    ["jsonInQuote", "jsonString"],
    ["json", "jsonStructure"],
  ];
  test.each(internalCases)("internal: %s → %s", (input, expected) => {
    expect(toCanonical(input)).toBe(expected);
  });

  test("unknown returns undefined", () => {
    expect(toCanonical("someWeirdContextXYZ" as any)).toBeUndefined();
  });
});

describe("contextMap.isEscapedCanonical", () => {
  test("escaped variants true", () => {
    expect(isEscapedCanonical("attributeEscaped")).toBe(true);
    expect(isEscapedCanonical("eventHandlerEscaped")).toBe(true);
    expect(isEscapedCanonical("jsonEscaped")).toBe(true);
  });
  test("non-escaped variants false", () => {
    expect(isEscapedCanonical("js")).toBe(false);
    expect(isEscapedCanonical("attributeInQuote")).toBe(false);
  });
  test("undefined false", () => {
    expect(isEscapedCanonical(undefined)).toBe(false);
  });
});

describe("contextMap.prettyPrintContext", () => {
  const prettyPairs: Array<[string, string]> = [
    ["js", "Script"],
    ["jsInQuote", "Script String"],
    ["jsTemplateLiteral", "JS Template Literal"],
    ["jsUri", "JavaScript URI"],
    ["dataUri", "Data URI"],
    ["css", "Style"],
    ["cssInQuote", "Style String"],
    ["eventHandler", "Event Handler Attribute"],
    ["eventHandlerEscaped", "Event Handler Attribute (encoded)"],
    ["attribute", "Tag Attribute (unquoted) Value"],
    ["attributeInQuote", "Tag Attribute (quoted) Value"],
    ["attributeEscaped", "Tag Attribute (encoded)"],
    ["jsonEscaped", "Script (JSON block, \\uXXXX)"],
    ["html", "HTML"],
    ["htmlcomment", "HTML Comment"],
    ["htmlBaseInjection", "HTML (Base Tag Injection)"],
    ["rawtextElement", "RAWTEXT/RCDATA Element"],
    ["svgContext", "SVG Context"],
    ["mathContext", "MathML Context"],
    ["domClobber", "DOM Clobbering (id/name)"],
    ["importMap", "Import Map"],
    ["importMapString", "Import Map String"],
    ["jsonString", "JSON String"],
    ["jsonStructure", "JSON Structure"],
    ["responseHeader", "Response Header"],
    ["responseSplitting", "Response Splitting (CRLF)"],
  ];
  test.each(prettyPairs)("%s → %s", (raw, expected) => {
    expect(prettyPrintContext(raw)).toBe(expected);
  });

  test("unknown falls back to raw", () => {
    expect(prettyPrintContext("strangeThing" as any)).toBe("strangeThing");
  });
});
