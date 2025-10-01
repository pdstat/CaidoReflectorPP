import { addEncodedSignal, getEncodedSignals, setEncodedSignals } from "../src/analysis/encodedSignalsStore.js";

describe("encodedSignalsStore", () => {
  test("addEncodedSignal creates and dedupes context/evidence within each entry", () => {
    const holder: any = {};
    addEncodedSignal(holder, { name: "p", source: "URL", contexts: ["a","a","b"], evidence: ["%22","%22","%3C"], count: 2 });
    addEncodedSignal(holder, { name: "q", source: "Body", contexts: ["x"], evidence: ["%5C"], count: 1 });
    const signals = getEncodedSignals(holder)!;
    expect(signals.length).toBe(2);
    const p = signals.find(s => s.name === "p")!;
    expect(p.contexts.sort()).toEqual(["a","b"]);
    expect(p.evidence.sort()).toEqual(["%22","%3C"]);
  });

  test("setEncodedSignals overrides existing and get returns same reference contents", () => {
    const holder: any = {};
    setEncodedSignals(holder, [{ name: "x", source: "Cookie", contexts: ["c"], evidence: ["%61"], count: 5 }]);
    const signals = getEncodedSignals(holder);
    expect(signals).toHaveLength(1);
    expect(signals?.[0].name).toBe("x");
  });

  test("empty holder returns undefined", () => {
    const holder: any = {};
    expect(getEncodedSignals(holder)).toBeUndefined();
  });
});
