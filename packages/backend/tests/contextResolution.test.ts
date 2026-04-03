import { resolveBestContext } from "../src/analysis/bodyReflection/contextResolution.ts";

describe("resolveBestContext", () => {
    const html = `<div>REF</div>`;
    const matches = [[5, 8]] as Array<[number, number]>;

    test("uses baseline classification when no contextInfo", () => {
        const best = resolveBestContext(matches, html, undefined, undefined);
        expect(best).toBe("HTML");
    });

    test("maps jsonString context to JSON String", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["jsonString"] });
        expect(best).toBe("JSON String");
    });

    test("maps jsonStructure context to JSON Structure", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["jsonStructure"] });
        expect(best).toBe("JSON Structure");
    });

    test("jsonString takes precedence over jsonStructure", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["jsonStructure", "jsonString"] });
        expect(best).toBe("JSON String");
    });

    test("maps eventHandlerAttrInQuote to Event Handler Attribute (quoted)", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["eventHandlerAttrInQuote"] });
        expect(best).toBe("Event Handler Attribute (quoted)");
    });

    test("maps eventHandlerAttr to Event Handler Attribute (unquoted)", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["eventHandlerAttr"] });
        expect(best).toBe("Event Handler Attribute (unquoted)");
    });

    test("maps urlAttrInQuote to URL Attribute (quoted)", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["urlAttrInQuote"] });
        expect(best).toBe("URL Attribute (quoted)");
    });

    test("maps urlAttr to URL Attribute (unquoted)", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["urlAttr"] });
        expect(best).toBe("URL Attribute (unquoted)");
    });

    test("maps styleAttrInQuote to Style Attribute (quoted)", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["styleAttrInQuote"] });
        expect(best).toBe("Style Attribute (quoted)");
    });

    test("maps styleAttr to Style Attribute (unquoted)", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["styleAttr"] });
        expect(best).toBe("Style Attribute (unquoted)");
    });

    test("maps cssUrl to CSS url()", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["cssUrl"] });
        expect(best).toBe("CSS url()");
    });

    test("maps srcsetUrlInQuote to Srcset Attribute (quoted)", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["srcsetUrlInQuote"] });
        expect(best).toBe("Srcset Attribute (quoted)");
    });

    test("maps metaRefresh to Meta Refresh URL", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["metaRefresh"] });
        expect(best).toBe("Meta Refresh URL");
    });

    test("maps srcdocHtmlInQuote to Iframe Srcdoc (quoted)", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["srcdocHtmlInQuote"] });
        expect(best).toBe("Iframe Srcdoc (quoted)");
    });

    test("maps templateHtml to Template HTML", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["templateHtml"] });
        expect(best).toBe("Template HTML");
    });

    test("maps jsonInQuote to JSON Script Block (string)", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["jsonInQuote"] });
        expect(best).toBe("JSON Script Block (string)");
    });

    test("maps json to JSON Script Block", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["json"] });
        expect(best).toBe("JSON Script Block");
    });

    test("maps htmlComment to HTML Comment", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["htmlComment"] });
        expect(best).toBe("HTML Comment");
    });

    test("cssUrl takes precedence over styleAttrInQuote", () => {
        const best = resolveBestContext(matches, html, undefined, { context: ["styleAttrInQuote", "cssUrl"] });
        expect(best).toBe("CSS url()");
    });
});
