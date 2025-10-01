import { mergeEncodedSignals } from "../src/analysis/mergeEncodedSignals.js";

describe("mergeEncodedSignals", () => {
  test("merges duplicates by name, unions contexts & evidence, sums counts", () => {
    const input = [
      { name: "param", source: "URL", contexts: ["attributeEscaped", "html"], evidence: ["%22"], count: 2 },
      { name: "param", source: "URL", contexts: ["eventHandlerEscaped", "html"], evidence: ["%22", "%3C"], count: 1 },
      { name: "other", source: "Body", contexts: ["jsonEscaped"], evidence: ["\\u003c"], count: 5 }
    ];
    const merged = mergeEncodedSignals(input);
    expect(merged.size).toBe(2);
    const param = merged.get("param");
    expect(param).toBeDefined();
    expect(Array.from(param!.contexts).sort()).toEqual(["attributeEscaped", "eventHandlerEscaped", "html"].sort());
    expect(Array.from(param!.evidence).sort()).toEqual(["%22", "%3C"].sort());
    expect(param!.count).toBe(3); // 2 + 1
    const other = merged.get("other");
    expect(other).toBeDefined();
    expect(Array.from(other!.contexts)).toEqual(["jsonEscaped"]);
    expect(Array.from(other!.evidence)).toEqual(["\\u003c"]);
    expect(other!.count).toBe(5);
  });

  test("empty or undefined input returns empty map", () => {
    expect(mergeEncodedSignals([]).size).toBe(0);
    expect(mergeEncodedSignals(undefined).size).toBe(0);
  });

  test("single entry preserved verbatim", () => {
    const single = [{ name: "x", source: "Cookie", contexts: ["attributeEscaped"], evidence: ["%3D"], count: 7 }];
    const merged = mergeEncodedSignals(single);
    const x = merged.get("x");
    expect(x).toBeDefined();
    expect(x!.count).toBe(7);
    expect(Array.from(x!.contexts)).toEqual(["attributeEscaped"]);
    expect(Array.from(x!.evidence)).toEqual(["%3D"]);
  });

  test("does not mutate original input arrays", () => {
    const original = [
      { name: "p", source: "URL", contexts: ["a"], evidence: ["e1"], count: 1 },
      { name: "p", source: "URL", contexts: ["b"], evidence: ["e2"], count: 2 }
    ];
    const copyContexts = original[0].contexts.slice();
    const copyEvidence = original[0].evidence.slice();
    mergeEncodedSignals(original);
    expect(original[0].contexts).toEqual(copyContexts);
    expect(original[0].evidence).toEqual(copyEvidence);
  });
});
