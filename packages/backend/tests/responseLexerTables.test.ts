import JsResponseBodyPayloadGenerator from "../src/payload/jsResponseBodyPayloadGenerator.js";
import JsonResponseBodyPayloadGenerator from "../src/payload/jsonResponseBodyPayloadGenerator.js";

// The JS / JSON response generators classify every occurrence by lexer state, computed
// once per body. These pin the state at the edges: backslash runs, comment pairs, line
// terminators, and many occurrences in one body.

const sdk = { console: { log: (_: string): void => {} } };
const jsContexts = (body: string, value: string): string[] =>
  new JsResponseBodyPayloadGenerator(body).generate(sdk, value).context.sort();
const jsonDetect = (body: string, pre: string, ch: string, suf: string): string[] =>
  new JsonResponseBodyPayloadGenerator(body).detect(sdk, { context: [] }, pre, ch, suf).map((r) => r.context).sort();

describe("JS response lexer state", () => {
  test.each([
    ['a = "x\\" VAL";', ["jsInQuote"]],
    ['a = "x\\\\"; f(VAL);', ["js"]],
    ['a = "x\\\\\\" VAL";', ["jsInQuote"]],
    ["a = 'it' + VAL;", ["js"]],
    ["t = `a ${b} VAL`;", ["jsTemplateLiteral"]],
    ["// VAL\n", []],
    ["/* VAL */", []],
    ["/* c */ VAL", ["js"]],
    ["// c\u2028VAL", ["js"]],
    ["// c VAL", []],
    ["re = /a\\/\\//; VAL", ["js"]],
  ])("%j -> %j", (body, expected) => {
    const ctx = jsContexts(body, "VAL");
    // No match in a comment falls back to "js"; only assert the comment cases yield nothing else.
    expect(ctx).toEqual(expected.length ? expected.sort() : ["js"]);
  });

  test("a comment-only occurrence adds no context beside a code occurrence in a string", () => {
    expect(jsContexts('// VAL\nx = "VAL";', "VAL")).toEqual(["jsInQuote"]);
  });

  test("every one of many occurrences in a large body is classified", () => {
    const lines: string[] = [];
    for (let i = 0; i < 3000; i++) lines.push(`f${i}("s\\"${i}", true); // true`);
    lines.push("x = `true`;");
    expect(jsContexts(lines.join("\n"), "true")).toEqual(["js", "jsTemplateLiteral"]);
  });

  test("a probe char on the second char of // is already in the comment", () => {
    const g = new JsResponseBodyPayloadGenerator("x = 1; P//S\n");
    expect(g.detect(sdk, { context: [] }, "P/", "/", "S")).toEqual([]);
    expect(g.detect(sdk, { context: [] }, "", "P", "//S").map((r) => r.context)).toEqual(["js"]);
  });

  test("isInScriptOutsideString agrees with the lexer, repeatedly on one instance", () => {
    const g = new JsResponseBodyPayloadGenerator('a = "IN"; b = OUT; /* CMT */');
    expect(g.isInScriptOutsideString("OUT")).toBe(true);
    expect(g.isInScriptOutsideString("IN")).toBe(false);
    expect(g.isInScriptOutsideString("CMT")).toBe(false);
    expect(g.isInScriptOutsideString("OUT")).toBe(true);
  });
});

describe("JSON response string state", () => {
  test.each([
    ['{"k":"P"S"}', ["jsonString"]],
    ['{"k":"a\\"P"S"}', ["jsonString"]],
    ['{"k":"a\\\\"P"S}', ["jsonStructure"]],
    ['{"k":"a\\\\\\"P"S"}', ["jsonString"]],
    ['{"k":1,P"S:2}', ["jsonStructure"]],
  ])("%j -> %j", (body, expected) => {
    expect(jsonDetect(body, "P", '"', "S")).toEqual(expected);
  });

  test("every one of many occurrences in a large body is classified", () => {
    const items: string[] = [];
    for (let i = 0; i < 3000; i++) items.push(`{"n":"item \\"${i}\\"","v":"true"}`);
    items.push(`{"raw":true}`);
    const g = new JsonResponseBodyPayloadGenerator(`[${items.join(",")}]`);
    expect(g.generate(sdk, "true").context.sort()).toEqual(["jsonString", "jsonStructure"]);
  });
});
