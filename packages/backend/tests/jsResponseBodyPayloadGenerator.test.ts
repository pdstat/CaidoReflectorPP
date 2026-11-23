import JsResponseBodyPayloadGenerator from "../src/payload/jsResponseBodyPayloadGenerator.ts";

const sdk = () => ({ console: { log: jest.fn() } });

const det = (
    body: string,
    prefix: string,
    payload: string,
    suffix: string
) => new JsResponseBodyPayloadGenerator(body).detect(sdk(), { context: [] }, prefix, payload, suffix);

const gen = (body: string, reflected = "REF") =>
    new JsResponseBodyPayloadGenerator(body).generate(sdk(), reflected);

describe("JsResponseBodyPayloadGenerator.generate()", () => {
    test("reports js (code) when the reflection is in call position", () => {
        const { payload, context } = gen(`REF({"status":"ok"});`);
        expect(context).toContain("js");
        expect(context).not.toContain("jsInQuote");
        // dangerous-only probe set
        expect(payload).toEqual(expect.arrayContaining(['"', "'", "`", "\\", "(", ";", "<", "/"]));
    });

    test("reports jsInQuote (double) inside a double-quoted string", () => {
        const { context } = gen(`var u = "REF";`);
        expect(context).toContain("jsInQuote");
        expect(context).not.toContain("jsInSQuote");
    });

    test("reports jsInSQuote inside a single-quoted string", () => {
        const { context } = gen(`var u = 'REF';`);
        expect(context).toEqual(expect.arrayContaining(["jsInQuote", "jsInSQuote"]));
    });

    test("reports jsTemplateLiteral inside backticks", () => {
        const { context } = gen("var u = `hi REF`;");
        expect(context).toContain("jsTemplateLiteral");
    });

    test("an escaped quote inside a closed string does not leak into code position", () => {
        // body is: var s = "a\"b"; REF  -- the \" is escaped and stays in the string,
        // the string closes at the second unescaped ", so REF is in code position.
        const { context } = gen(`var s = "a\\"b"; REF`);
        expect(context).toContain("js");
    });
});

describe("JsResponseBodyPayloadGenerator.detect()", () => {
    test("detects a code-position breakout char", () => {
        const res = det(`cb(1);AAAAA;ZZZZZ`, "AAAAA", ";", "ZZZZZ");
        expect(res.map((r) => r.context)).toContain("js");
        expect(res.map((r) => r.char)).toContain(";");
    });

    test("detects a surviving quote inside a string literal", () => {
        const res = det(`var u = "AAAAA"ZZZZZ";`, "AAAAA", '"', "ZZZZZ");
        expect(res.map((r) => r.context)).toContain("jsInQuote");
    });
});

describe("JsResponseBodyPayloadGenerator.isInScriptOutsideString()", () => {
    test("true for a marker in code position", () => {
        expect(new JsResponseBodyPayloadGenerator(`cb();MARKER`).isInScriptOutsideString("MARKER")).toBe(true);
    });

    test("false for a marker inside a string literal", () => {
        expect(new JsResponseBodyPayloadGenerator(`var x = "MARKER";`).isInScriptOutsideString("MARKER")).toBe(false);
    });
});

describe("JsResponseBodyPayloadGenerator comments", () => {
    test("a char reflected inside a // line comment is not a code-position survivor", () => {
        const body = `run();//# sourceMappingURL=https://x/sym.map?version=AAAAA/BBBBB&v=1\n//abc`;
        expect(det(body, "AAAAA", "/", "BBBBB")).toEqual([]);
    });

    test("a char reflected inside a /* block */ comment is not a code-position survivor", () => {
        const body = `/* build AAAAA;BBBBB */ run();`;
        expect(det(body, "AAAAA", ";", "BBBBB")).toEqual([]);
    });

    test("code after a line comment ends is still code", () => {
        const body = `// header\nAAAAA;BBBBB();`;
        expect(det(body, "AAAAA", ";", "BBBBB").map((d) => d.context)).toEqual(["js"]);
    });

    test("code after a block comment closes is still code", () => {
        const body = `/* a */ AAAAA;BBBBB();`;
        expect(det(body, "AAAAA", ";", "BBBBB").map((d) => d.context)).toEqual(["js"]);
    });

    test("// inside a string literal is not a comment", () => {
        const body = `var u = "https://x/AAAAA'BBBBB";`;
        expect(det(body, "AAAAA", "'", "BBBBB").map((d) => d.context)).toEqual(["jsInQuote"]);
    });

    test("an apostrophe inside a comment does not flip later code into a string", () => {
        const body = `// don't\nAAAAA;BBBBB();`;
        expect(det(body, "AAAAA", ";", "BBBBB").map((d) => d.context)).toEqual(["js"]);
    });

    test("an escaped slash (regex /a\\/\\//) does not start a comment", () => {
        const body = `var r = /a\\/\\//; AAAAA;BBBBB();`;
        expect(det(body, "AAAAA", ";", "BBBBB").map((d) => d.context)).toEqual(["js"]);
    });

    test("isInScriptOutsideString is false inside a comment", () => {
        const pg = new JsResponseBodyPayloadGenerator(`x();// NEEDLE`);
        expect(pg.isInScriptOutsideString("NEEDLE")).toBe(false);
    });
});

describe("JsResponseBodyPayloadGenerator line terminators", () => {
    test("U+2028 ends a line comment", () => {
        const body = `// note\u2028AAAAA;BBBBB();`;
        expect(det(body, "AAAAA", ";", "BBBBB").map((d) => d.context)).toEqual(["js"]);
    });

    test("a space does not end a line comment", () => {
        const body = `// note AAAAA;BBBBB();`;
        expect(det(body, "AAAAA", ";", "BBBBB")).toEqual([]);
    });
});

describe("JsResponseBodyPayloadGenerator percent-encoded reflections", () => {
    const body = `s.ss_(window,'x',['https://a.example/p?eid\\x3d375603261%2C466465926\\x26u\\x3d1']);`;

    test("a value echoed still percent-encoded inside a string is jsInQuote, not code", () => {
        const { context } = gen(body, "375603261,466465926");
        expect(context).toContain("jsInQuote");
        expect(context).not.toContain("js");
    });

    test("the raw (encoded) form of the value is matched too", () => {
        const { context } = gen(body, "375603261%2C466465926");
        expect(context).toContain("jsInQuote");
        expect(context).not.toContain("js");
    });

    test("a value with no occurrence still falls back to js", () => {
        expect(gen(`var a = 1;`, "nothere").context).toEqual(["js"]);
    });
});
