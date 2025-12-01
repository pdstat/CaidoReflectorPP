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

    test("context gating filters out other contexts", () => {
        const res = det(`{"key":"REF","other":REF}`, ["jsonString"], "", "REF", "");
        expect(res.map((r) => r.context)).toEqual(["jsonString"]);
    });

    test("returns empty when marker absent", () => {
        const res = det(`{"key":"VALUE"}`, ["jsonString"], "", "REF", "");
        expect(res).toHaveLength(0);
    });
});
