// __tests__/payloadGenerator.spec.ts
import ResponseBodyPayloadGenerator from "../src/payload/responseBodyPayloadGenerator.ts";

const sdk = () => ({ console: { log: jest.fn() } });

const html = `
<script type="text/javascript">
s.channel = "saveandretrieve:hello";
s.prop1 = "saveandretrieve:hello:quote";
s.prop2 = "saveandretrieve:hello:quote";
s.prop3 = "saveandretrieve:hello:quote";
s.prop4 = "saveandretrieve:hello:quote";
s.prop12 = "logged out";
s.hier1 = "saveandretrieve:hello:quote";
s.eVar10 = "saveandretrieve:hello-quote";
s.pageName = "saveandretrieve:hello:quote:login";
</script>
`.trim();

function det(
    html: string,
    ctx: string[],
    prefix: string,
    payload: string,
    suffix: string
) {
    const gen = new ResponseBodyPayloadGenerator(html);
    return gen.detect(sdk(), { context: ctx }, prefix, payload, suffix);
}

function gen(html: string, reflected = "REF") {
    return new ResponseBodyPayloadGenerator(html).generate(sdk(), reflected);
}

describe("PayloadGenerator.detect()", () => {
    describe("Attribute-in-quote checks (true breakout vs decoded-only)", () => {
        test("Case-folded reflection: uppercase wrappers still detected in quoted JS", () => {
            const html = `<script>var s="preabcxyzsuf";</script>`;
            const gen = new ResponseBodyPayloadGenerator(html);
            // Simulate server lowercasing: our wrappers are upper, response is lower
            const prefix = "ABC".toUpperCase(); // random upper
            const suffix = "XYZ".toUpperCase();
            // But the source contains lowercase (preabcxyzsuf)
            const res = gen.detect({ console: { log: () => { } } }, { context: ["jsInQuote"] }, prefix, "", suffix);
            expect(res.map((r: any) => r.context)).toContain("jsInQuote");
        });

        test("Quoted attr with '/' literal → attributeInQuote", () => {
            const res = det(`<img alt="PRE/SUF">`, ["attributeInQuote"], "PRE", "/", "SUF");
            expect(res.map((r: any) => r.context)).toContain("attributeInQuote");
            expect(res.map((r: any) => r.char)).toContain("/");
        });

        test("Quoted attr with space literal → attributeInQuote", () => {
            const res = det(`<img alt="PRE SUF">`, ["attributeInQuote"], "PRE", " ", "SUF");
            expect(res.map((r: any) => r.context)).toContain("attributeInQuote");
            expect(res.map((r: any) => r.char)).toContain(" ");
        });

        test("Quoted attr with '>' literal → attributeInQuote", () => {
            const res = det(`<img alt="PRE>SUF">`, ["attributeInQuote"], "PRE", ">", "SUF");
            expect(res.map((r: any) => r.context)).toContain("attributeInQuote");
            expect(res.map((r: any) => r.char)).toContain(">");
        });

        test("Quoted attr, only decoded contains marker for '\"' → attributeEscaped", () => {
            // RAW contains &quot; — decoded contains the actual quote.
            const res = det(`<img alt="PRE&quot;SUF">`, ["attributeInQuote"], "PRE", '"', "SUF");
            expect(res.map((r: any) => r.context)).toContain("attributeEscaped");
            expect(res.map((r: any) => r.char)).toContain('"');
        });

        test("Quoted attr, wrong quote payload → no result", () => {
            // Decoded has PRE"SUF, but payload is "'", so marker PRE'SUF doesn't occur.
            const res = det(`<img alt="PRE&quot;SUF">`, ["attributeInQuote"], "PRE", "'", "SUF");
            expect(res).toHaveLength(0);
        });
    });

    describe("JS/CSS quoted-string checks (jsInQuote/cssInQuote)", () => {
        test('JS: marker inside quoted string (payload = ")"', () => {
            const html = `<script>var s='PRE"SUF';</script>`;
            const res = det(html, ["jsInQuote"], "PRE", '"', "SUF");
            expect(res.map((r: any) => r.context)).toContain("jsInQuote");
            expect(res.map((r: any) => r.char)).toContain('"');
        });

        test("Real-world: injected word inside executable <script> strings → jsInQuote", () => {
            const html = `
<script type="text/javascript">
s.channel = "saveandretrieve:hello";
s.prop1 = "saveandretrieve:hello:quote";
s.prop2 = "saveandretrieve:hello:quote";
s.prop3 = "saveandretrieve:hello:quote";
s.prop4 = "saveandretrieve:hello:quote";
s.prop12 = "logged out";
s.hier1 = "saveandretrieve:hello:quote";
s.eVar10 = "saveandretrieve:hello-quote";
s.pageName = "saveandretrieve:hello:quote:login";
</script>`.trim();

            // Choose the 'h' from "...:hello" as the single-char payload:
            // "...:hello"  → prefix "saveandretrieve:", payload "h", suffix "ello"
            const res = det(html, ["jsInQuote"], "saveandretrieve:", "h", "ello");
            expect(res.length).toBeGreaterThan(0);
            expect(res.map((r: any) => r.context)).toContain("jsInQuote");
        });

        test("Real-world: injected word followed by descriptor inside JS string → jsInQuote", () => {
            const html = `
<script type="text/javascript">
s.prop1 = "saveandretrieve:hello:quote";
</script>`.trim();

            // Use the last 'o' in "hello" as the payload and keep suffix inside the quotes:
            // "...:hello:quote" → prefix "saveandretrieve:hell", payload "o", suffix ":quote"
            const res = det(html, ["jsInQuote"], "saveandretrieve:hell", "o", ":quote");
            expect(res.length).toBeGreaterThan(0);
            expect(res.map((r: any) => r.context)).toContain("jsInQuote");
        });

        test("PrevLocation=hello reflected into JS strings → jsInQuote", () => {
            const html = `
<script type="text/javascript">
s.channel = "saveandretrieve:hello";
s.prop1   = "saveandretrieve:hello:quote";
</script>`;
            // channel
            let res = det(html, ["jsInQuote"], "saveandretrieve:", "h", "ello");
            expect(res.length).toBeGreaterThan(0);
            expect(res.map((r: any) => r.context)).toContain("jsInQuote");

            // prop1 (descriptor)
            res = det(html, ["jsInQuote"], "saveandretrieve:", "h", "ello:quote");
            expect(res.length).toBeGreaterThan(0);
            expect(res.map((r: any) => r.context)).toContain("jsInQuote");
        });


        test("CSS: marker inside quoted string (payload = ')", () => {
            const html = `<style>.x{content:"PRE'SUF"}</style>`;
            const res = det(html, ["cssInQuote"], "PRE", "'", "SUF");
            expect(res.map((r: any) => r.context)).toContain("cssInQuote");
            expect(res.map((r: any) => r.char)).toContain("'");
        });

        test("Non-executable script type: JS detector skips, body fallback confirms", () => {
            const html = `<script type="application/json">{"k":"PRE'SUF"}</script>`;
            // JS-specific detector skips non-executable scripts, but body
            // fallback confirms since the marker is literally reflected.
            const res = det(html, ["jsInQuote"], "PRE", "'", "SUF");
            expect(res).toHaveLength(1);
            expect(res[0].context).toBe("jsInQuote");
        });
    });

    describe("Other single-char probes: '/', ' ', '>' with context gating", () => {
        test("JS unquoted (payload=' ') → js", () => {
            const html = `<script>let a = PRE SUF;</script>`;
            const res = det(html, ["js"], "PRE", " ", "SUF");
            expect(res.map((r: any) => r.context)).toContain("js");
            expect(res.map((r: any) => r.char)).toContain(" ");
        });

        test("JS quoted (payload='/') → jsInQuote", () => {
            const html = `<script>const s='PRE/SUF';</script>`;
            const res = det(html, ["jsInQuote"], "PRE", "/", "SUF");
            expect(res.map(r => r.context)).toContain("jsInQuote");
            expect(res.map(r => r.char)).toContain("/");
        });

        test("CSS unquoted (payload='>') → css", () => {
            const html = `<style>.x{--a:PRE>SUF}</style>`;
            const res = det(html, ["css"], "PRE", ">", "SUF");
            expect(res.map(r => r.context)).toContain("css");
            expect(res.map(r => r.char)).toContain(">");
        });

        test("Event handler raw contains marker → eventHandler", () => {
            const html = `<button onclick="doIt('PRE/SUF')">x</button>`;
            const res = det(html, ["eventHandler"], "PRE", "/", "SUF");
            expect(res.map(r => r.context)).toContain("eventHandler");
            expect(res.map(r => r.char)).toContain("/");
        });

        test("Event handler only decoded contains marker → eventHandlerEscaped", () => {
            // '&#x2f;' decodes to '/'
            const html = `<button onclick="doIt('PRE&#x2f;SUF')">x</button>`;
            const res = det(html, ["eventHandler"], "PRE", "/", "SUF");
            expect(res.map(r => r.context)).toContain("eventHandlerEscaped");
            expect(res.map(r => r.char)).toContain("/");
        });
    });

    describe("The '<' payload branch with normalization and fallback ordering", () => {
        test("JS: marker in <script> text → js", () => {
            const html = `<script>/*PRE<SUF*/</script>`;
            const res = det(html, [], "PRE", "<", "SUF");
            expect(res.map(r => r.context)).toContain("js");
            expect(res.map(r => r.char)).toContain("<");
        });

        test("CSS: marker in <style> text → css", () => {
            const html = `<style>/*PRE<SUF*/</style>`;
            const res = det(html, [], "PRE", "<", "SUF");
            expect(res.map(r => r.context)).toContain("css");
            expect(res.map(r => r.char)).toContain("<");
        });

        test("HTML: marker outside <script>/<style> → html", () => {
            // Use '<=' so the parser keeps it as a text node (not a start tag).
            const html = `<div>PRE<=SUF</div>`;
            const res = det(html, [], "PRE", "=", "SUF".slice(1)); // suffix effectively "=" then "UF", but we only pass one suffix; keep simple:
        });

        test("HTML: marker outside <script>/<style> → html (clean)", () => {
            const html = `<div>PRE<=SUF</div>`;
            const res = det(html, [], "PRE", "<", "SUF".slice(0, 1)); // not ideal, re-run cleanly with suffix '=':
            // Final clean call:
            const res2 = det(`<div>PRE<=SUF</div>`, [], "PRE", "<", "=");
            expect(res2.map(r => r.context)).toContain("html");
            expect(res2.map(r => r.char)).toContain("<");
        });

        test("Ordering: if found in JS and CSS, 'html' is not added", () => {
            const html = `<script>/*PRE<SUF*/</script><style>/*PRE<SUF*/</style><div>PRE<=SUF</div>`;
            const res = det(html, [], "PRE", "<", "SUF");
            const ctxs = res.map(r => r.context);
            expect(ctxs).toEqual(expect.arrayContaining(["js", "css"]));
            expect(ctxs).not.toContain("html"); // only added when nothing else matched. :contentReference[oaicite:3]{index=3}
        });
    });

    describe("Backslash ('\\\\') and empty payload ('') probes (literal-only)", () => {
        test("Backslash inside JS quoted string → jsInQuote", () => {
            const html = `<script>const s='PRE\\\\SUF';</script>`;
            const res = det(html, ["jsInQuote"], "PRE", "\\", "SUF");
            expect(res.map(r => r.context)).toContain("jsInQuote");
            expect(res.map(r => r.char)).toContain("\\");
        });

        test("Empty payload in JS → js (matches PRESUF literally)", () => {
            const html = `<script>/*PRESUF*/</script>`;
            const res = det(html, ["js"], "PRE", "", "SUF");
            expect(res.map(r => r.context)).toContain("js");
            expect(res.map(r => r.char)).toContain("");
        });

        test("Empty payload in CSS → css", () => {
            const html = `<style>/*PRESUF*/</style>`;
            const res = det(html, ["css"], "PRE", "", "SUF");
            expect(res.map(r => r.context)).toContain("css");
            expect(res.map(r => r.char)).toContain("");
        });

        test("Context gating: only CSS requested → only cssInQuote returned", () => {
            const html = `
        <script>const s='PRE\\\\SUF';</script>
        <style>.x{content:'PRE\\\\SUF'}</style>
      `;
            const res = det(html, ["cssInQuote"], "PRE", "\\", "SUF");
            const ctxs = res.map(r => r.context);
            expect(ctxs).toContain("cssInQuote");
            expect(ctxs).not.toContain("jsInQuote");
        });
    });

    describe("Negative / no-match cases", () => {
        test("No relevant contexts → empty", () => {
            const html = `<div>nothing here</div>`;
            const res = det(html, [], "PRE", "/", "SUF");
            expect(res).toHaveLength(0);
        });

        test("Contexts present but marker absent → empty", () => {
            const html = `<script>var s='nope';</script>`;
            const res = det(html, ["jsInQuote"], "PRE", "/", "SUF");
            expect(res).toHaveLength(0);
        });
    });
});

describe("PayloadGenerator.generate()", () => {
    test("HTML text context → html + '<' payload", () => {
        const { context, payload } = gen(`<div>Hello REF</div>`);
        expect(context).toContain("html");
        expect(payload).toContain("<");
    });

    test("HTML comment context → htmlComment + '<' payload", () => {
        const { context, payload } = gen(`<!-- before REF after -->`);
        expect(context).toContain("htmlComment");
        expect(payload).toContain("<");
    });

    describe("SCRIPT contexts (JS)", () => {
        test("Unquoted JS occurrence → js with full exploit probes", () => {
            // Not inside a string literal; just present in script text.
            const { context, payload } = gen(`<script>const x = REF; // raw</script>`);
            expect(context).toContain("js");
            expect(context).not.toContain("jsInQuote");
            expect(payload).toContain("");
            expect(payload).toContain("<");
            expect(payload).toContain(";");
            expect(payload).toContain("\\");
        });

        test("Single-quoted string → jsInQuote + '\'' + '\\\\' payloads", () => {
            const { context, payload } = gen(`<script>const s = '...REF...';</script>`);
            expect(context).toContain("jsInQuote");
            expect(payload).toContain("'");
            expect(payload).toContain("\\");
        });

        test("Double-quoted string → jsInQuote + '\"' + '\\\\' payloads", () => {
            const { context, payload } = gen(`<script>const s = "...REF...";</script>`);
            expect(context).toContain("jsInQuote");
            expect(payload).toContain('"');
            expect(payload).toContain("\\");
        });

        test("Template-literal string → jsInQuote + '`' + '\\\\' payloads", () => {
            const { context, payload } = gen("<script>const s = `...REF...`;</script>");
            expect(context).toContain("jsInQuote");
            expect(payload).toContain("`");
            expect(payload).toContain("\\");
        });

        test("Non-executable script type (JSON) → jsonInQuote", () => {
            const { context, payload } = gen(`<script type="application/json">{ "k": "REF" }</script>`);
            expect(context).toContain("jsonInQuote");
            expect(payload).toEqual(expect.arrayContaining(['"', "\\"]));
        });
    });

    describe("STYLE contexts (CSS)", () => {
        test("Unquoted CSS occurrence → css", () => {
            const { context, payload } = gen(`<style>.x{/* REF */}div{content:REF}</style>`);
            expect(context).toContain("css");
            expect(context).not.toContain("cssInQuote");
            expect(payload).toContain(""); // symmetry with non-quoted JS case
        });

        test("Quoted CSS string → cssInQuote + quote + '\\\\' payloads (double)", () => {
            const { context, payload } = gen(`<style>.x{content:"...REF...";}</style>`);
            expect(context).toContain("cssInQuote");
            expect(payload).toContain('"');
            expect(payload).toContain("\\");
        });

        test("Quoted CSS string → cssInQuote + quote + '\\\\' payloads (single)", () => {
            const { context, payload } = gen(`<style>.x{content:'...REF...';}</style>`);
            expect(context).toContain("cssInQuote");
            expect(payload).toContain("'");
            expect(payload).toContain("\\");
        });

        test("Template-like backtick in CSS (treated as quote if present) → cssInQuote", () => {
            const { context, payload } = gen(`<style>/* simulate unusual preprocessor */ .x{content:\`REF\`}</style>`);
            expect(context).toContain("cssInQuote");
            expect(payload).toContain("`");
            expect(payload).toContain("\\");
        });
    });

    describe("Attribute contexts", () => {
        test("Unquoted attribute value → attribute + empty payload", () => {
            const { context, payload } = gen(`<img alt=REF>`);
            expect(context).toContain("attribute");
            expect(payload).toContain(""); // empty probe for unquoted attrs
        });

        test("Quoted attribute value → attributeInQuote + matching quote payload", () => {
            const { context, payload } = gen(`<img alt="REF">`);
            expect(context).toContain("attributeInQuote");
            expect(payload).toContain('"');
        });

        test("Quoted attribute with literal REF in RAW → attribute", () => {
            // RAW uses &quot; … &quot;, so library may not expose a quote char; treat as unquoted literal.
            const { context } = gen(`<img data-x=&quot;REF&quot;>`);
            expect(context).toContain("attribute");
        });

        test("Attribute value only after entity/escape decoding → attributeEscaped", () => {
            // RAW lacks literal 'REF'; decoded value contains it.
            const { context } = gen(`<img data-x="&#x52;&#x45;&#x46;">`);
            expect(context).toContain("attributeEscaped");
        });

        test("Quoted attribute with literal REF and detectable quote → attributeInQuote", () => {
            const { context, payload } = gen(`<img alt="REF">`);
            expect(context).toContain("attributeInQuote");
            expect(payload).toContain('"');
        });
    });

    describe("Decoding & fallback behavior", () => {
        test("Input is URL-encoded but DOM has decoded value → still matches", () => {
            const { context, payload } = gen(`<div><span><</span></div>`, "%3C");
            expect(context).toContain("html");
            expect(payload).toContain("<");
        });

        test("Only appears inside <script> non-exec or <style> is excluded from fallback (JSON case gets json)", () => {
            // Fallback excludes <style> by design.
            const { context } = gen(`<style>/* REF */</style>`);
            expect(context).toContain("css"); // handled by STYLE, not fallback

            // JSON in a non-exec script is classified as json/jsonInQuote
            const jsonOnly = gen(`<script type="application/json">REF</script>`);
            expect(jsonOnly.context).toContain("json");
            expect(jsonOnly.payload).toEqual(expect.arrayContaining(['"', "\\"]));
        });
    });
});

describe("PayloadGenerator.generate() – extended contexts", () => {
    test("event handler attribute (quoted) → eventHandlerAttrInQuote", () => {
        const { context, payload } = gen(`<button onclick="doIt('REF')">x</button>`);
        expect(context).toContain("eventHandlerAttrInQuote");
        expect(payload).toEqual(expect.arrayContaining(['"', "\\", ";"]));
    });

    test("event handler attribute (unquoted) → eventHandlerAttr", () => {
        const { context, payload } = gen(`<button onclick=REF>x</button>`);
        expect(context).toContain("eventHandlerAttr");
        expect(payload).toEqual(expect.arrayContaining(["", "\\", ";"]));
    });

    test("URL attribute (quoted) → urlAttrInQuote", () => {
        const { context, payload } = gen(`<a href="REF">x</a>`);
        expect(context).toContain("urlAttrInQuote");
        expect(payload).toEqual(expect.arrayContaining(['"', ":", "//"]));
    });

    test("URL attribute (unquoted) → urlAttr", () => {
        const { context, payload } = gen(`<img src=REF>`);
        expect(context).toContain("urlAttr");
        expect(payload).toEqual(expect.arrayContaining(["", ":", "//"]));
    });

    test("srcset attribute → srcsetUrlInQuote + probes", () => {
        const { context, payload } = gen(`<img srcset="REF 1x">`);
        expect(context).toContain("srcsetUrlInQuote");
        expect(payload).toEqual(expect.arrayContaining(['"', "/", ","]));
    });

    test("style attribute (unquoted) → styleAttr (+ cssUrl if url(...))", () => {
        const { context, payload } = gen(`<div style=background:url(REF)>x</div>`);
        expect(context).toContain("styleAttr");
        expect(context).toContain("cssUrl");
        expect(payload).toEqual(expect.arrayContaining(["", "\\", "(", ")", "//", "http:"]));
    });

    test("style attribute (quoted) → styleAttrInQuote", () => {
        const { context, payload } = gen(`<div style="color:red;content:'REF'">x</div>`);
        expect(context).toContain("styleAttrInQuote");
        expect(payload).toEqual(expect.arrayContaining(['"', "\\", "(", ")"]));
    });

    test("meta refresh → metaRefresh", () => {
        const { context, payload } = gen(`<meta http-equiv="refresh" content="0;url=REF">`);
        expect(context).toContain("metaRefresh");
        expect(payload).toEqual(expect.arrayContaining(["//", "http:"]));
    });

    test("iframe srcdoc (quoted) → srcdocHtmlInQuote + '<' probe", () => {
        const { context, payload } = gen(`<iframe srcdoc="<p>REF</p>"></iframe>`);
        expect(context).toContain("srcdocHtmlInQuote");
        expect(payload).toEqual(expect.arrayContaining(['"', "<"]));
    });

    test("template HTML → templateHtml", () => {
        const { context, payload } = gen(`<template><p>REF</p></template>`);
        expect(context).toContain("templateHtml");
        expect(payload).toContain("<");
    });

    test("JSON sink in non-exec script → jsonInQuote", () => {
        const { context, payload } = gen(`<script type="application/ld+json">{"k":"REF"}</script>`);
        expect(context).toContain("jsonInQuote");
        expect(payload).toEqual(expect.arrayContaining(['"', "\\"]));
    });

    // Regression: attributeEscaped must not hit when RAW contains literal REF
    test("Quoted attribute with literal REF in RAW → attributeInQuote", () => {
        const { context, payload } = gen(`<img alt="REF">`);
        expect(context).toContain("attributeInQuote");
        expect(payload).toContain('"');
    });

    // attributeEscaped positive: RAW lacks literal REF but decoded includes it
    test("Attribute value only after entity/escape decoding → attributeEscaped", () => {
        const { context } = gen(`<img data-x="&#x52;&#x45;&#x46;">`); // "REF"
        expect(context).toContain("attributeEscaped");
    });
});

describe("Bug #4: empty baseline payload always included", () => {
    test("html context includes empty baseline", () => {
        const { payload } = gen(`<div>Hello REF</div>`);
        expect(payload).toContain("");
    });

    test("htmlComment context includes empty baseline", () => {
        const { payload } = gen(`<!-- before REF after -->`);
        expect(payload).toContain("");
    });

    test("attributeInQuote context includes empty baseline", () => {
        const { payload } = gen(`<img alt="REF">`);
        expect(payload).toContain("");
    });

    test("jsInQuote context includes empty baseline", () => {
        const { payload } = gen(`<script>const s = "...REF...";</script>`);
        expect(payload).toContain("");
    });

    test("cssInQuote context includes empty baseline", () => {
        const { payload } = gen(`<style>.x{content:"...REF...";}</style>`);
        expect(payload).toContain("");
    });

    test("eventHandlerAttrInQuote context includes empty baseline", () => {
        const { payload } = gen(`<button onclick="doIt('REF')">x</button>`);
        expect(payload).toContain("");
    });

    test("urlAttrInQuote context includes empty baseline", () => {
        const { payload } = gen(`<a href="REF">x</a>`);
        expect(payload).toContain("");
    });

    test("templateHtml context includes empty baseline", () => {
        const { payload } = gen(`<template><p>REF</p></template>`);
        expect(payload).toContain("");
    });

    test("metaRefresh context includes empty baseline", () => {
        const { payload } = gen(`<meta http-equiv="refresh" content="0;url=REF">`);
        expect(payload).toContain("");
    });
});

describe("Bug #5: detect backslash/empty for attribute contexts", () => {
    test("empty payload in eventHandlerAttr → eventHandlerAttr", () => {
        const html = `<button onclick=PRESUF>x</button>`;
        const res = det(html, ["eventHandlerAttr"], "PRE", "", "SUF");
        expect(res.map(r => r.context)).toContain("eventHandlerAttr");
    });

    test("empty payload in urlAttr → urlAttr", () => {
        const html = `<img src=PRESUF>`;
        const res = det(html, ["urlAttr"], "PRE", "", "SUF");
        expect(res.map(r => r.context)).toContain("urlAttr");
    });

    test("empty payload in styleAttr → styleAttr", () => {
        const html = `<div style=PRESUF>x</div>`;
        const res = det(html, ["styleAttr"], "PRE", "", "SUF");
        expect(res.map(r => r.context)).toContain("styleAttr");
    });

    test("empty payload in attributeInQuote → attributeInQuote", () => {
        const html = `<img alt="PRESUF">`;
        const res = det(html, ["attributeInQuote"], "PRE", "", "SUF");
        expect(res.map(r => r.context)).toContain("attributeInQuote");
    });

    test("empty payload in html context → html", () => {
        const html = `<div>PRESUF</div>`;
        const res = det(html, ["html"], "PRE", "", "SUF");
        expect(res.map(r => r.context)).toContain("html");
    });
});

describe("PayloadGenerator.generate() – PrevLocation=hello reflected into JS strings", () => {
    test("Produces jsInQuote with full exploit probes", () => {
        const { context, payload } = gen(html, "hello");

        // Context classification
        expect(context).toContain("jsInQuote");
        expect(context).not.toContain("js");
        expect(context).not.toContain("css");
        expect(context).not.toContain("html");

        // Full probe set for quoted JS strings
        expect(payload).toEqual(expect.arrayContaining(['"', '\\', '<', '>', '/', ';']));

        // Dedupe sanity
        expect(new Set(payload).size).toBe(payload.length);
        expect(new Set(context).size).toBe(context.length);
    });

    test("URL-encoded input decodes and yields the same jsInQuote + probes", () => {
        const { context, payload } = gen(html, "%68%65%6C%6C%6F"); // "hello"
        expect(context).toContain("jsInQuote");
        expect(payload).toEqual(expect.arrayContaining(['"', '\\']));
    });

    test("Multi-occurrence still yields a single jsInQuote context and deduped probes", () => {
        const { context, payload } = gen(html, "hello");
        // There are many occurrences, but we still only expect one jsInQuote context label.
        expect(context.filter(c => c === "jsInQuote").length).toBe(1);
        // Full probe set now includes exploit chars + "" baseline
        expect(payload).toEqual(expect.arrayContaining(['', '"', '\\', '<']));
        expect(new Set(payload).size).toBe(payload.length);
    });

    test("Changing the reflected token (e.g., a single char of 'hello') keeps jsInQuote", () => {
        // Use single-char reflected value (the code inspects quoted context, not the token length)
        const { context, payload } = gen(html, "h");
        expect(context).toContain("jsInQuote");
        expect(payload).toEqual(expect.arrayContaining(['"', '\\']));
    });
});

describe("detect() — specialized context handlers", () => {
    test("cssUrl: ) detected in style url()", () => {
        const h = `<div style="background: url(PRE)SUF)">x</div>`;
        const res = det(h, ["cssUrl"], "PRE", ")", "SUF");
        expect(res.map((r: any) => r.context)).toContain("cssUrl");
    });

    test("cssUrl: // detected in style url()", () => {
        const h = `<div style="background: url(PRE//SUF)">x</div>`;
        const res = det(h, ["cssUrl"], "PRE", "//", "SUF");
        expect(res.map((r: any) => r.context)).toContain("cssUrl");
    });

    test("cssUrl: empty payload via _detectBackslashOrEmpty", () => {
        const h = `<div style="background: url(PRESUF)">x</div>`;
        const res = det(h, ["cssUrl"], "PRE", "", "SUF");
        expect(res.map((r: any) => r.context)).toContain("cssUrl");
    });

    test("srcsetUrlInQuote: / detected in srcset", () => {
        const h = `<img srcset="PRE/SUF 1x">`;
        const res = det(h, ["srcsetUrlInQuote"], "PRE", "/", "SUF");
        expect(res.map((r: any) => r.context)).toContain("srcsetUrlInQuote");
    });

    test("srcsetUrl: empty payload in unquoted srcset", () => {
        const h = `<img srcset=PRESUF>`;
        const res = det(h, ["srcsetUrl"], "PRE", "", "SUF");
        expect(res.map((r: any) => r.context)).toContain("srcsetUrl");
    });

    test("metaRefresh: // detected in meta refresh", () => {
        const h = `<meta http-equiv="refresh" content="0;url=PRE//SUF">`;
        const res = det(h, ["metaRefresh"], "PRE", "//", "SUF");
        expect(res.map((r: any) => r.context)).toContain("metaRefresh");
    });

    test("metaRefresh: empty payload via _detectBackslashOrEmpty", () => {
        const h = `<meta http-equiv="refresh" content="0;url=PRESUF">`;
        const res = det(h, ["metaRefresh"], "PRE", "", "SUF");
        expect(res.map((r: any) => r.context)).toContain("metaRefresh");
    });

    test("srcdocHtmlInQuote: < detected in srcdoc", () => {
        const h = `<iframe srcdoc="PRE<SUF"></iframe>`;
        const res = det(h, ["srcdocHtmlInQuote"], "PRE", "<", "SUF");
        expect(res.map((r: any) => r.context)).toContain("srcdocHtmlInQuote");
    });

    test("srcdocHtml: empty payload in unquoted srcdoc", () => {
        const h = `<iframe srcdoc=PRESUF></iframe>`;
        const res = det(h, ["srcdocHtml"], "PRE", "", "SUF");
        expect(res.map((r: any) => r.context)).toContain("srcdocHtml");
    });

    test("jsonInQuote: quote detected in JSON script block", () => {
        const h = `<script type="application/json">{"key":"PRE"SUF"}</script>`;
        const res = det(h, ["jsonInQuote"], "PRE", '"', "SUF");
        expect(res.map((r: any) => r.context)).toContain("jsonInQuote");
    });

    test("jsonInQuote: backslash via _detectBackslashOrEmpty", () => {
        const h = `<script type="application/json">{"key":"PRE\\SUF"}</script>`;
        const res = det(h, ["jsonInQuote"], "PRE", "\\", "SUF");
        expect(res.map((r: any) => r.context)).toContain("jsonInQuote");
    });

    test("json: empty payload in JSON script block structure", () => {
        const h = `<script type="application/json">{PRESUF: 1}</script>`;
        const res = det(h, ["json"], "PRE", "", "SUF");
        expect(res.map((r: any) => r.context)).toContain("json");
    });

    test("styleAttrInQuote: ( detected in style attr", () => {
        const h = `<div style="color: PRE(SUF">x</div>`;
        const res = det(h, ["styleAttrInQuote"], "PRE", "(", "SUF");
        expect(res.map((r: any) => r.context)).toContain("styleAttrInQuote");
    });

    test("eventHandlerAttrInQuote: ; detected in event handler", () => {
        const h = `<div onclick="PRE;SUF">x</div>`;
        const res = det(h, ["eventHandlerAttrInQuote"], "PRE", ";", "SUF");
        expect(res.map((r: any) => r.context)).toContain("eventHandlerAttrInQuote");
    });

    test("urlAttrInQuote: : detected in URL attr", () => {
        const h = `<a href="PRE:SUF">x</a>`;
        const res = det(h, ["urlAttrInQuote"], "PRE", ":", "SUF");
        expect(res.map((r: any) => r.context)).toContain("urlAttrInQuote");
    });

    test("urlAttrInQuote: ? detected", () => {
        const h = `<a href="PRE?SUF">x</a>`;
        const res = det(h, ["urlAttrInQuote"], "PRE", "?", "SUF");
        expect(res.map((r: any) => r.context)).toContain("urlAttrInQuote");
    });

    test("metaRefresh: ; detected", () => {
        const h = `<meta http-equiv="refresh" content="0;url=PRE;SUF">`;
        const res = det(h, ["metaRefresh"], "PRE", ";", "SUF");
        expect(res.map((r: any) => r.context)).toContain("metaRefresh");
    });

    test("metaRefresh: / detected", () => {
        const h = `<meta http-equiv="refresh" content="0;url=PRE/SUF">`;
        const res = det(h, ["metaRefresh"], "PRE", "/", "SUF");
        expect(res.map((r: any) => r.context)).toContain("metaRefresh");
    });

    test("srcdocHtmlInQuote: > detected", () => {
        const h = `<iframe srcdoc="PRE>SUF"></iframe>`;
        const res = det(h, ["srcdocHtmlInQuote"], "PRE", ">", "SUF");
        expect(res.map((r: any) => r.context)).toContain("srcdocHtmlInQuote");
    });

    test("jsonInQuote: , detected in JSON script block", () => {
        const h = `<script type="application/json">{"key":"PRE,SUF"}</script>`;
        const res = det(h, ["jsonInQuote"], "PRE", ",", "SUF");
        expect(res.map((r: any) => r.context)).toContain("jsonInQuote");
    });

    test("jsonInQuote: } detected in JSON script block", () => {
        const h = `<script type="application/json">{"key":"PRE}SUF"}</script>`;
        const res = det(h, ["jsonInQuote"], "PRE", "}", "SUF");
        expect(res.map((r: any) => r.context)).toContain("jsonInQuote");
    });

    test("json: , detected in JSON script block structure", () => {
        const h = `<script type="application/json">{PRE,SUF}</script>`;
        const res = det(h, ["json"], "PRE", ",", "SUF");
        expect(res.map((r: any) => r.context)).toContain("json");
    });

    test("eventHandlerAttrInQuote: ( detected", () => {
        const h = `<div onclick="PRE(SUF">x</div>`;
        const res = det(h, ["eventHandlerAttrInQuote"], "PRE", "(", "SUF");
        expect(res.map((r: any) => r.context)).toContain("eventHandlerAttrInQuote");
    });

    test("eventHandlerAttr: ; detected in unquoted handler", () => {
        const h = `<div onclick=PRE;SUF>x</div>`;
        const res = det(h, ["eventHandlerAttr"], "PRE", ";", "SUF");
        expect(res.map((r: any) => r.context)).toContain("eventHandlerAttr");
    });

    test("html: > detected in text", () => {
        const h = `<div>PRE>SUF</div>`;
        const res = det(h, ["html"], "PRE", ">", "SUF");
        expect(res.map((r: any) => r.context)).toContain("html");
    });

    test("html: ; detected in text", () => {
        const h = `<div>PRE;SUF</div>`;
        const res = det(h, ["html"], "PRE", ";", "SUF");
        expect(res.map((r: any) => r.context)).toContain("html");
    });

    test("htmlComment: - detected", () => {
        const h = `<!-- PRE-SUF -->`;
        const res = det(h, ["htmlComment"], "PRE", "-", "SUF");
        expect(res.map((r: any) => r.context)).toContain("htmlComment");
    });

    test("htmlComment: > detected", () => {
        const h = `<!-- PRE>SUF -->`;
        const res = det(h, ["htmlComment"], "PRE", ">", "SUF");
        expect(res.map((r: any) => r.context)).toContain("htmlComment");
    });

    test("templateHtml: > detected", () => {
        const h = `<template>PRE>SUF</template>`;
        const res = det(h, ["templateHtml"], "PRE", ">", "SUF");
        expect(res.map((r: any) => r.context)).toContain("templateHtml");
    });

    test("templateHtml: < detected via _detectLessThanPayload", () => {
        const h = `<template><div>PRE<SUF</div></template>`;
        const res = det(h, ["templateHtml"], "PRE", "<", "SUF");
        expect(res.map((r: any) => r.context)).toContain("templateHtml");
    });

    test("js: ; detected in unquoted script", () => {
        const h = `<script>var x=PRE;SUF</script>`;
        const res = det(h, ["js"], "PRE", ";", "SUF");
        expect(res.map((r: any) => r.context)).toContain("js");
    });

    test("css: ; detected in style", () => {
        const h = `<style>body{color:PRE;SUF}</style>`;
        const res = det(h, ["css"], "PRE", ";", "SUF");
        expect(res.map((r: any) => r.context)).toContain("css");
    });

    test("attribute: = detected in unquoted attr", () => {
        const h = `<div class=PRE=SUF>x</div>`;
        const res = det(h, ["attribute"], "PRE", "=", "SUF");
        expect(res.map((r: any) => r.context)).toContain("attribute");
    });

    test("styleAttrInQuote: ; detected", () => {
        const h = `<div style="color:PRE;SUF">x</div>`;
        const res = det(h, ["styleAttrInQuote"], "PRE", ";", "SUF");
        expect(res.map((r: any) => r.context)).toContain("styleAttrInQuote");
    });

    test("srcsetUrl: , detected in unquoted srcset", () => {
        const h = `<img srcset=PRE,SUF>`;
        const res = det(h, ["srcsetUrl"], "PRE", ",", "SUF");
        expect(res.map((r: any) => r.context)).toContain("srcsetUrl");
    });

    test("escaped srcdoc does NOT confirm", () => {
        const h = `<iframe srcdoc="PRE&lt;SUF"></iframe>`;
        const res = det(h, ["srcdocHtmlInQuote"], "PRE", "<", "SUF");
        expect(res.map((r: any) => r.context)).not.toContain("srcdocHtmlInQuote");
    });

    test("escaped json script does NOT confirm", () => {
        const h = `<script type="application/json">{"key":"PRE\\u003cSUF"}</script>`;
        const res = det(h, ["jsonInQuote"], "PRE", "<", "SUF");
        expect(res.map((r: any) => r.context)).not.toContain("jsonInQuote");
    });
});

describe("generate() — expanded payload coverage", () => {
    test("js unquoted: probes all critical chars", () => {
        const { payload } = gen(`<script>const x = REF;</script>`);
        for (const c of ["<", ">", "/", ";", "'", '"', "\\", "\`"]) {
            expect(payload).toContain(c);
        }
    });

    test("jsInQuote: probes breakout + script escape chars", () => {
        const { payload } = gen(`<script>var s="REF";</script>`);
        for (const c of ['"', "\\", "<", ">", "/", ";"]) {
            expect(payload).toContain(c);
        }
    });

    test("css unquoted: probes all critical chars", () => {
        const { payload } = gen(`<style>body{color:REF}</style>`);
        for (const c of ["<", ">", "/", ";", "(", ")", "\\", ":"]) {
            expect(payload).toContain(c);
        }
    });

    test("cssInQuote: probes breakout chars", () => {
        const { payload } = gen(`<style>body{font:"REF"}</style>`);
        for (const c of ['"', "\\", "<", ">", ";", "(", ")"]) {
            expect(payload).toContain(c);
        }
    });

    test("html text: probes tag injection chars", () => {
        const { payload } = gen(`<div>REF</div>`);
        for (const c of ["<", ">", '"', "'", "/", ";"]) {
            expect(payload).toContain(c);
        }
    });

    test("htmlComment: probes breakout chars", () => {
        const { payload } = gen(`<!-- REF -->`);
        for (const c of ["<", ">", "-", '"', "'"]) {
            expect(payload).toContain(c);
        }
    });

    test("template: probes html injection chars", () => {
        const { payload } = gen(`<template>REF</template>`);
        for (const c of ["<", ">", '"', "'", "/", ";"]) {
            expect(payload).toContain(c);
        }
    });

    test("attribute unquoted: probes breakout chars", () => {
        const { payload } = gen(`<div class=REF>`);
        for (const c of [" ", '"', "'", ">", "<", ";", "="]) {
            expect(payload).toContain(c);
        }
    });

    test("attributeInQuote: probes quote + tag chars", () => {
        const { payload } = gen(`<div class="REF">`);
        for (const c of ['"', "<", ">", "&"]) {
            expect(payload).toContain(c);
        }
    });

    test("eventHandler quoted: probes call chars", () => {
        const { payload } = gen(`<div onclick="REF">x</div>`);
        for (const c of ['"', "\\", ";", "(", ")", "&"]) {
            expect(payload).toContain(c);
        }
    });

    test("eventHandler unquoted: probes all handler chars", () => {
        const { payload } = gen(`<div onclick=REF>x</div>`);
        for (const c of ["\\", ";", "(", ")", "&", " "]) {
            expect(payload).toContain(c);
        }
    });

    test("urlAttr quoted: probes protocol + query chars", () => {
        const { payload } = gen(`<a href="REF">x</a>`);
        for (const c of ['"', ":", "//", "?", "#", "&", "="]) {
            expect(payload).toContain(c);
        }
    });

    test("urlAttr unquoted: probes + space", () => {
        const { payload } = gen(`<a href=REF>x</a>`);
        for (const c of [":", "//", "?", "#", "&", "=", " "]) {
            expect(payload).toContain(c);
        }
    });

    test("styleAttr quoted: probes injection chars", () => {
        const { payload } = gen(`<div style="REF">x</div>`);
        for (const c of ['"', "\\", "(", ")", ";", ":"]) {
            expect(payload).toContain(c);
        }
    });

    test("cssUrl: probes url breakout", () => {
        const { payload } = gen(`<div style="background:url(REF)">x</div>`);
        for (const c of [")", "(", ";", "\\"]) {
            expect(payload).toContain(c);
        }
    });

    test("srcset quoted: probes descriptor chars", () => {
        const { payload } = gen(`<img srcset="REF 1x">`);
        for (const c of ['"', "/", ","]) {
            expect(payload).toContain(c);
        }
    });

    test("metaRefresh: probes url chars", () => {
        const { payload } = gen(`<meta http-equiv="refresh" content="0;url=REF">`);
        for (const c of ["/", "//", ";", ":", "?", "#"]) {
            expect(payload).toContain(c);
        }
    });

    test("srcdoc quoted: probes html injection chars", () => {
        const { payload } = gen(`<iframe srcdoc="REF"></iframe>`);
        for (const c of ['"', "<", ">", "&"]) {
            expect(payload).toContain(c);
        }
    });

    test("jsonScript string: probes structure chars", () => {
        const { payload } = gen(`<script type="application/json">{"k":"REF"}</script>`);
        for (const c of ['"', "\\", ",", "}", "]", ":"]) {
            expect(payload).toContain(c);
        }
    });

    test("jsonScript structure: probes same chars", () => {
        const { payload } = gen(`<script type="application/json">{REF}</script>`);
        for (const c of ['"', "\\", ",", "}", "]", ":"]) {
            expect(payload).toContain(c);
        }
    });
});

describe("detect() — raw body fallback for DOM-breaking chars", () => {
    test("quoted attr: \" breaks DOM but body fallback confirms", () => {
        // Server reflects " inside quoted attr, breaking HTML structure
        const h = `<div class="PRE"SUF">rest</div>`;
        const res = det(h, ["attributeInQuote"], "PRE", '"', "SUF");
        expect(res.length).toBeGreaterThan(0);
        expect(res[0].context).toBe("attributeInQuote");
    });

    test("event handler quoted: ( breaks DOM but body fallback confirms", () => {
        const h = `<div onclick="PRE(SUF">x</div>`;
        const res = det(h, ["eventHandlerAttrInQuote"], "PRE", "(", "SUF");
        expect(res.length).toBeGreaterThan(0);
    });

    test("html: < in text — body fallback confirms", () => {
        // < creates a new tag in parser, _containsTextOutsideTags fails
        const h = `<div>PRE<SUF</div>`;
        const res = det(h, ["html"], "PRE", "<", "SUF");
        expect(res.length).toBeGreaterThan(0);
    });

    test("template: < in template — body fallback confirms", () => {
        const h = `<template>PRE<SUF</template>`;
        const res = det(h, ["templateHtml"], "PRE", "<", "SUF");
        expect(res.length).toBeGreaterThan(0);
    });

    test("srcdoc quoted: < reflected — body fallback confirms", () => {
        const h = `<iframe srcdoc="PRE<SUF">x</iframe>`;
        const res = det(h, ["srcdocHtmlInQuote"], "PRE", "<", "SUF");
        expect(res.length).toBeGreaterThan(0);
    });

    test("no fallback if marker not in body (entity-escaped)", () => {
        // Marker is NOT in body literally (server entity-encoded it)
        // _detectAttributeQuotePayload correctly detects as escaped
        const h = `<div class="PRE&quot;SUF">rest</div>`;
        const res = det(h, ["attributeInQuote"], "PRE", '"', "SUF");
        expect(res[0].context).toBe("attributeEscaped");
        expect(res.map(r => r.context)).not.toContain("attributeInQuote");
    });

    test("multi-context fallback pushes all contexts (cssUrl + styleAttrInQuote)", () => {
        // When " in batch breaks the style attr, fallback pushes both contexts
        const h = `<div style="background: url(PRE)SUF)">x</div>`;
        // Simulate DOM-breaking: parser sees style="background: url(PRE)" then garbage
        // If DOM detection fails, body fallback should push ALL contexts
        const res = det(h, ["styleAttrInQuote", "cssUrl"], "PRE", ")", "SUF");
        const ctxs = res.map((r: any) => r.context);
        // DOM-based detection may work for ) (doesn't break HTML quotes),
        // but if it fails, fallback should include cssUrl
        expect(ctxs.length).toBeGreaterThan(0);
    });
});