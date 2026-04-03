import { isLiteralContext, allowedDetectionContextsFor } from "../src/utils/contexts.js";

describe("isLiteralContext", () => {
  const trueCases = [
    "js",
    "attributeInQuote",
    "attribute",
    "html",
    "htmlComment",
    "eventHandler",
    "cssInQuote",
    "css",
  ];
  test.each(trueCases)("%s => true", (c) => {
    expect(isLiteralContext(c)).toBe(true);
  });

  const falseCases = [
    "attributeEscaped",
    "eventHandlerEscaped",
    "jsonScript",
    "", // empty
  ];
  test.each(falseCases)("%s => false", (c) => {
    expect(isLiteralContext(c)).toBe(false);
  });

  test("undefined => false", () => {
    expect(isLiteralContext(undefined as any)).toBe(false);
  });
});

describe("allowedDetectionContextsFor", () => {
  test("script variants", () => {
    expect(Array.from(allowedDetectionContextsFor("Script").values()).sort()).toEqual(["js", "jsInQuote"].sort());
    expect(Array.from(allowedDetectionContextsFor("script string (\")").values()).sort()).toEqual(["js", "jsInQuote"].sort());
  });

  test("style variants", () => {
    expect(Array.from(allowedDetectionContextsFor("Style").values()).sort()).toEqual(["css", "cssInQuote"].sort());
    expect(Array.from(allowedDetectionContextsFor("style string (')").values()).sort()).toEqual(["css", "cssInQuote"].sort());
  });

  test("event handler", () => {
    expect(Array.from(allowedDetectionContextsFor("Event Handler Attribute").values()).sort()).toEqual(["eventHandler", "eventHandlerAttr", "eventHandlerAttrInQuote"].sort());
  });

  test("attribute variants", () => {
    expect(Array.from(allowedDetectionContextsFor("Tag Attribute (quoted) Value").values()).sort()).toEqual(["attribute", "attributeInQuote"].sort());
    expect(Array.from(allowedDetectionContextsFor("Tag Attribute (unquoted) Value").values()).sort()).toEqual(["attribute", "attributeInQuote"].sort());
  });

  test("html / body", () => {
    expect(Array.from(allowedDetectionContextsFor("HTML").values())).toEqual(["html"]);
    expect(Array.from(allowedDetectionContextsFor("body snippet").values())).toEqual(["html"]);
  });

  test("url attribute variants", () => {
    expect(Array.from(allowedDetectionContextsFor("URL Attribute (quoted)").values()).sort()).toEqual(["urlAttr", "urlAttrInQuote"].sort());
    expect(Array.from(allowedDetectionContextsFor("URL Attribute (unquoted)").values()).sort()).toEqual(["urlAttr", "urlAttrInQuote"].sort());
  });

  test("style attribute variants", () => {
    expect(Array.from(allowedDetectionContextsFor("Style Attribute (quoted)").values()).sort()).toEqual(["styleAttr", "styleAttrInQuote"].sort());
    expect(Array.from(allowedDetectionContextsFor("Style Attribute (unquoted)").values()).sort()).toEqual(["styleAttr", "styleAttrInQuote"].sort());
  });

  test("css url", () => {
    expect(Array.from(allowedDetectionContextsFor("CSS url()").values())).toEqual(["cssUrl"]);
  });

  test("srcset", () => {
    expect(Array.from(allowedDetectionContextsFor("Srcset Attribute (quoted)").values()).sort()).toEqual(["srcsetUrl", "srcsetUrlInQuote"].sort());
  });

  test("meta refresh", () => {
    expect(Array.from(allowedDetectionContextsFor("Meta Refresh URL").values())).toEqual(["metaRefresh"]);
  });

  test("iframe srcdoc", () => {
    expect(Array.from(allowedDetectionContextsFor("Iframe Srcdoc (quoted)").values()).sort()).toEqual(["srcdocHtml", "srcdocHtmlInQuote"].sort());
  });

  test("template html", () => {
    expect(Array.from(allowedDetectionContextsFor("Template HTML").values())).toEqual(["templateHtml"]);
  });

  test("html comment", () => {
    expect(Array.from(allowedDetectionContextsFor("HTML Comment").values())).toEqual(["htmlComment"]);
  });

  test("json script block", () => {
    expect(Array.from(allowedDetectionContextsFor("JSON Script Block (string)").values()).sort()).toEqual(["json", "jsonInQuote"].sort());
  });

  test("unknown context => empty", () => {
    expect(allowedDetectionContextsFor("weirdThing").size).toBe(0);
  });
});
