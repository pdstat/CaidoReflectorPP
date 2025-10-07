import { isLiteralContext, allowedDetectionContextsFor } from "../src/utils/contexts.js";

describe("isLiteralContext", () => {
  const trueCases = [
    "js",
    "attributeInQuote",
    "attribute",
    "html",
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
    "htmlComment",
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
    expect(Array.from(allowedDetectionContextsFor("Event Handler Attribute").values())).toEqual(["eventHandler"]);
  });

  test("attribute variants", () => {
    expect(Array.from(allowedDetectionContextsFor("Tag Attribute (quoted) Value").values()).sort()).toEqual(["attribute", "attributeInQuote"].sort());
    expect(Array.from(allowedDetectionContextsFor("Tag Attribute (unquoted) Value").values()).sort()).toEqual(["attribute", "attributeInQuote"].sort());
  });

  test("html / body", () => {
    expect(Array.from(allowedDetectionContextsFor("HTML").values())).toEqual(["html"]);
    expect(Array.from(allowedDetectionContextsFor("body snippet").values())).toEqual(["html"]);
  });

  test("unknown context => empty", () => {
    expect(allowedDetectionContextsFor("weirdThing").size).toBe(0);
  });
});
