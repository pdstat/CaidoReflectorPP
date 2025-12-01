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
});
