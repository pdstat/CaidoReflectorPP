import {
  canonicalizeContext,
  generateReport,
  buildEncodedSignalsSection,
  buildRequestContextLine,
  buildStructuredDataBlock,
  buildFindingTitle
} from "../src/analysis/reporting.js";

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
  test("confirmed param with chars, value, snippets", () => {
    const param: any = {
      name: "q",
      matches: [[10, 14], [100, 104]],
      context: "jsInQuote",
      aggressive: ['"', '<'],
      source: "URL",
      value: "test",
      severity: "critical",
      confirmed: true
    };
    const body = " ".repeat(10) + "test" + " ".repeat(86) + "test" + " ".repeat(50);
    const out = generateReport(param, body);

    expect(out).toContain("### q · Script String · Critical");
    expect(out).toContain("**Source:** URL");
    expect(out).toContain("**Value:** `test`");
    expect(out).toContain("**Confirmed**");
    expect(out).toContain("2 reflections");
    expect(out).toContain('**Reflected chars:** `"` `<`');
    expect(out).toContain("String breakout");
    expect(out).toContain("Test: `");
    expect(out).toContain("**Snippets:**");
    expect(out).toContain("(offset 10)");
  });

  test("unconfirmed param with no chars", () => {
    const param: any = {
      name: "id",
      matches: [[0, 2]],
      context: "html",
      source: "URL",
      value: "42",
      severity: "info",
      confirmed: false
    };
    const out = generateReport(param);
    expect(out).toContain("### id · HTML · Info");
    expect(out).toContain("**Unconfirmed**");
    expect(out).toContain("1 reflection");
    expect(out).not.toContain("**Reflected chars:**");
  });

  test("header reflection shows header names", () => {
    const param: any = {
      name: "redir",
      matches: [[0, 0]],
      context: "Response Header",
      headers: ["Location"],
      source: "URL",
      value: "https://example.com",
      severity: "high",
      confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("### redir · Response Header · High");
    expect(out).toContain("**Headers:** Location");
    expect(out).toContain("Open redirect");
    expect(out).toContain("Test: `https://evil.com`");
  });

  test("otherContexts displayed", () => {
    const param: any = {
      name: "t",
      matches: [[0, 1]],
      context: "js",
      otherContexts: { attributeInQuote: 3, html: 1 },
      source: "URL",
      severity: "high",
      confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("Also in: Tag Attribute (quoted) Value ×3, HTML ×1");
  });

  test("value truncated at 60 chars", () => {
    const param: any = {
      name: "long",
      matches: [[0, 1]],
      context: "html",
      source: "URL",
      value: "a".repeat(100),
      severity: "low",
      confirmed: true
    };
    const out = generateReport(param);
    expect(out).toMatch(/\*\*Value:\*\* `a{59}…`/);
  });

  test("snippets capped at 3", () => {
    const matches: Array<[number, number]> = [
      [10, 14], [100, 104], [200, 204], [300, 304], [400, 404]
    ];
    const param: any = {
      name: "x",
      matches,
      context: "html",
      source: "URL",
      severity: "medium",
      confirmed: true,
      aggressive: ['<']
    };
    const body = " ".repeat(500);
    const out = generateReport(param, body);
    const snippetLines = out.split("\n").filter(l => /^\d+\. /.test(l));
    expect(snippetLines.length).toBeLessThanOrEqual(3);
  });
});

describe("buildRequestContextLine", () => {
  test("full context with all headers present", () => {
    const line = buildRequestContextLine({
      method: "GET",
      url: "https://example.com/search",
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
      csp: "script-src 'self'",
      xcto: "nosniff"
    });
    expect(line).toBe(
      "`GET` · `https://example.com/search` · `200` · `text/html`"
    );
  });

  test("missing CSP and XCTO noted", () => {
    const line = buildRequestContextLine({
      method: "POST",
      url: "https://example.com/api",
      statusCode: 302,
      contentType: "text/html"
    });
    expect(line).toContain("No CSP");
    expect(line).toContain("No X-Content-Type-Options");
  });
});

describe("buildEncodedSignalsSection", () => {
  test("merges duplicates, shows decoded pairs", () => {
    const section = buildEncodedSignalsSection([
      { name: "p", source: "URL", contexts: ["attributeEscaped", "html"], evidence: ["%3C"], count: 2 },
      { name: "p", source: "URL", contexts: ["eventHandlerEscaped"], evidence: ["%3C", "&lt;"], count: 1 },
      { name: "q", source: "Cookie", contexts: ["jsonEscaped"], evidence: ["\\u003c"], count: 4 }
    ]);
    expect(section).toContain("#### Encoded reflections (informational)");
    expect(section).toContain("**p**");
    expect(section).toContain("≈3 matches");
    expect(section).toContain("`%3C`→`<`");
    expect(section).toContain("`&lt;`→`<`");
    expect(section).toContain("**q**");
    expect(section).toContain("`\\u003c`→`<`");
  });

  test("empty input returns empty string", () => {
    expect(buildEncodedSignalsSection(undefined)).toBe("");
    expect(buildEncodedSignalsSection([])).toBe("");
  });
});

describe("buildStructuredDataBlock", () => {
  test("produces HTML comment with JSON array", () => {
    const params: any[] = [{
      name: "q", source: "URL", context: "jsInQuote",
      severity: "critical", confirmed: true,
      aggressive: ['"', '<'], matches: [[0, 1], [2, 3]]
    }];
    const block = buildStructuredDataBlock(params);
    expect(block).toMatch(/^<!-- REFLECTOR_DATA/);
    expect(block).toMatch(/-->$/);
    const json = block.replace(/<!-- REFLECTOR_DATA\n/, "").replace(/\n-->/, "");
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].param).toBe("q");
    expect(parsed[0].severity).toBe("critical");
    expect(parsed[0].confirmed).toBe(true);
    expect(parsed[0].chars).toEqual(['"', '<']);
    expect(parsed[0].reflections).toBe(2);
  });
});

describe("buildFindingTitle", () => {
  test("single confirmed param", () => {
    const title = buildFindingTitle([{
      name: "q", matches: [[0, 1]], context: "jsInQuote",
      severity: "critical", confirmed: true, source: "URL"
    }], true);
    expect(title).toBe('Reflected: "q" in Script String (Critical)');
  });

  test("multiple params sorted by severity, max 2 names", () => {
    const title = buildFindingTitle([
      { name: "id", matches: [[0, 1]], context: "html", severity: "medium", confirmed: true, source: "URL", aggressive: ['<'] },
      { name: "q", matches: [[0, 1]], context: "jsInQuote", severity: "critical", confirmed: true, source: "URL", aggressive: ['"'] },
      { name: "z", matches: [[0, 1]], context: "css", severity: "medium", confirmed: true, source: "URL" }
    ], true);
    expect(title).toContain('"q"');
    expect(title).toContain("Critical");
  });

  test("encoded-only findings", () => {
    const title = buildFindingTitle([{
      name: "tok", matches: [[0, 0]], context: "jsonEscaped",
      severity: "info", confirmed: false, source: "URL"
    }], false);
    expect(title).toContain("Encoded reflections");
    expect(title).toContain("Info");
  });

  test("empty params list", () => {
    expect(buildFindingTitle([], false)).toBe("Encoded reflections (informational)");
  });
});
