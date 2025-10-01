import { canonicalizeContext, generateReport, buildEncodedSignalsSection } from "../src/analysis/reporting.js";

describe("canonicalizeContext", () => {
  const cases: Array<[string, string]> = [
    ["js", "Script"],
    ["script", "Script"],
    ["jsInQuote", "Script String"],
    ["script string", "Script String"],
    ["css", "Style"],
    ["cssInQuote", "Style String"],
    ["eventHandler", "Event Handler Attribute"],
    ["eventHandlerEscaped", "Event Handler Attribute (encoded)"],
    ["attributeInQuote", "Tag Attribute (quoted) Value"],
    ["attributeEscaped", "Tag Attribute (encoded)"],
    ["jsonEscaped", "Script (JSON block, \\uXXXX)"],
    ["attribute", "Tag Attribute (unquoted) Value"],
    ["html", "HTML"],
    ["htmlcomment", "HTML Comment"]
  ];
  test.each(cases)("%s → %s", (input, expected) => {
    expect(canonicalizeContext(input)).toBe(expected);
  });

  test("unknown context stays mostly unchanged", () => {
    expect(canonicalizeContext("weirdContext123")).toBe("weirdContext123");
  });
});

describe("generateReport", () => {
  test("builds detailed report with headers, otherContexts sorting, aggressive chars", () => {
    const param: any = {
      name: "token",
      matches: [[0,1],[2,3]],
      context: "attributeEscaped", // main context
      otherContexts: { js: 5, attributeInQuote: 3, html: 1 }, // should sort by count desc
      aggressive: ["", "<", '"', "`"],
      source: "Body",
      headers: ["Location", "Set-Cookie"],
      score: 85.4,
      confidence: 60.2,
      severity: 70.7,
      certainty: 85.4 // legacy alias
    };
    const out = generateReport(param);
    // Core pieces
    expect(out).toContain("token – reflected 2 time(s) in Tag Attribute (encoded)");
    expect(out).toContain("also in Script ×5, Tag Attribute (quoted) Value ×3, HTML ×1");
    expect(out).toContain("in header(s): Location, Set-Cookie");
    expect(out).toContain("(source: Body)");
    expect(out).toMatch(/score=85%/); // rounded
    expect(out).toMatch(/confidence=60%/);
    expect(out).toMatch(/severity=71%/); // rounded 70.7
    // Aggressive characters formatting: empty shown as <empty>, others JSON encoded
    expect(out).toContain("<empty>");
    expect(out).toContain("\"<\"");
    expect(out).toContain("\"\\\"\""); // escaped quote JSON encoding
    expect(out).toContain("\"`\"");
    // Trailing newline
    expect(out.endsWith("\n"));
  });
});

describe("buildEncodedSignalsSection", () => {
  test("merges duplicate names and unions contexts/evidence", () => {
    const section = buildEncodedSignalsSection([
      { name: "p", source: "URL", contexts: ["attributeEscaped", "html"], evidence: ["%22"], count: 2 },
      { name: "p", source: "URL", contexts: ["eventHandlerEscaped"], evidence: ["%22", "%3C"], count: 1 },
      { name: "q", source: "Cookie", contexts: ["jsonEscaped"], evidence: ["\\u003c"], count: 4 }
    ]);
    expect(section).toContain("Encoded reflections (informational):");
    // p line aggregated
    expect(section).toMatch(/- p → .*attributeEscaped.*html.*eventHandlerEscaped/);
    expect(section).toMatch(/matches≈3/);
    expect(section).toContain("evidence: %22, %3C");
    // q line
    expect(section).toMatch(/- q → jsonEscaped \(matches≈4; evidence: \\u003c\)/);
  });

  test("empty input returns empty string", () => {
    expect(buildEncodedSignalsSection(undefined)).toBe("");
    expect(buildEncodedSignalsSection([])).toBe("");
  });
});
