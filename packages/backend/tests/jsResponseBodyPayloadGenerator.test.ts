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
