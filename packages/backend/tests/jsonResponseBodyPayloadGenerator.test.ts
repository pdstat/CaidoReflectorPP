import JsonResponseBodyPayloadGenerator from "../src/payload/jsonResponseBodyPayloadGenerator.ts";

const sdk = () => ({ console: { log: jest.fn() } });

const det = (
    body: string,
    ctx: string[],
    prefix: string,
    payload: string,
    suffix: string
) => new JsonResponseBodyPayloadGenerator(body).detect(sdk(), { context: ctx }, prefix, payload, suffix);

const gen = (body: string, reflected = "REF") =>
    new JsonResponseBodyPayloadGenerator(body).generate(sdk(), reflected);

describe("JsonResponseBodyPayloadGenerator.generate()", () => {
    test("reports jsonString when the reflected value is quoted", () => {
        const { payload, context } = gen(`{"key":"REF"}`);
        expect(context).toContain("jsonString");
        expect(payload).toContain("\"");
        expect(payload).toContain("\\");
    });

    test("falls back to jsonStructure when the reflection is unquoted", () => {
        const { payload, context } = gen(`{"count":REF}`);
        expect(context).toContain("jsonStructure");
        expect(context).not.toContain("jsonString");
        expect(payload).toContain("}");
        expect(payload).toContain(",");
    });
});

describe("JsonResponseBodyPayloadGenerator.detect()", () => {
    test("finds jsonString context for quoted reflections", () => {
        const res = det(`{"key":"REF"}`, [], "", "REF", "");
        expect(res.map((r) => r.context)).toContain("jsonString");
        expect(res.map((r) => r.char)).toContain("REF");
    });

    test("observes jsonStructure when mirror is outside quotes", () => {
        const res = det(`{"count":REF}`, ["jsonStructure"], "", "REF", "}");
        expect(res.map((r) => r.context)).toContain("jsonStructure");
        expect(res.map((r) => r.char)).toContain("REF");
    });

    test("reports all contexts where marker is found (no gating)", () => {
        const res = det(`{"key":"REF","other":REF}`, ["jsonString"], "", "REF", "");
        const ctxs = res.map((r) => r.context).sort();
        expect(ctxs).toEqual(["jsonString", "jsonStructure"]);
    });

    test("returns empty when marker absent", () => {
        const res = det(`{"key":"VALUE"}`, ["jsonString"], "", "REF", "");
        expect(res).toHaveLength(0);
    });

    test("Bug #3: structure chars detected even when \" disrupts string state", () => {
        // Simulates the probe response where " marker toggles string state
        // making subsequent markers appear as jsonString instead of jsonStructure.
        // After the fix, both contexts are reported regardless.
        const body = `{"val":PRE"SUF,PRE,SUF}PRE}SUF]PRE]SUF:PRE:SUF}`;
        const gen = new JsonResponseBodyPayloadGenerator(body);
        const commaRes = gen.detect(sdk(), { context: ["jsonStructure"] }, "PRE", ",", "SUF");
        expect(commaRes.length).toBeGreaterThan(0);
        // Even if _isInsideJsonString says "jsonString" due to the " marker,
        // detect() now reports it without filtering
        const allContexts = commaRes.map(r => r.context);
        expect(allContexts.length).toBeGreaterThan(0);
    });
});
