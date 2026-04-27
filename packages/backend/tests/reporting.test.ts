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

  test("header reflection skips body snippets", () => {
    const param: any = {
      name: "tok",
      matches: [[0, 0]],
      context: "Response Header",
      headers: ["Set-Cookie"],
      source: "URL",
      severity: "high",
      confirmed: true
    };
    const body = "<!DOCTYPE html><html><body>page</body></html>";
    const out = generateReport(param, body);
    expect(out).not.toContain("Snippets");
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
    expect(out).toContain("Also in: Tag Attribute (quoted) Value ×3, HTML");
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
    expect(title).toBe('Reflected: (Critical) "q" in Script String');
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

  test("new context titles render correctly", () => {
    const cases: Array<[string, string]> = [
      ["rawtextElement", "RAWTEXT/RCDATA Element"],
      ["jsUri", "JavaScript URI"],
      ["svgContext", "SVG Context"],
      ["jsTemplateLiteral", "JS Template Literal"],
      ["htmlBaseInjection", "HTML (Base Tag Injection)"],
      ["domClobber", "DOM Clobbering (id/name)"],
      ["importMapString", "Import Map String"],
      ["responseSplitting", "Response Splitting (CRLF)"],
      ["dataUri", "Data URI"],
    ];
    for (const [ctx, label] of cases) {
      const title = buildFindingTitle([{
        name: "x", matches: [[0, 1]], context: ctx,
        severity: "high", confirmed: true, source: "URL"
      }], true);
      expect(title).toContain(label);
    }
  });

  test("header reflection includes header name", () => {
    const title = buildFindingTitle([{
      name: "redir", matches: [[0, 1]], context: "Response Header",
      severity: "medium", confirmed: true, source: "URL",
      headers: ["X-Custom"]
    }], true);
    expect(title).toBe('Reflected: (Medium) "redir" in X-Custom Header');
  });

  test("location header with open redirect position", () => {
    const title = buildFindingTitle([{
      name: "url", matches: [[0, 1]], context: "Response Header",
      severity: "high", confirmed: true, source: "URL",
      headers: ["Location"], redirectPosition: "full-url"
    }], true);
    expect(title).toBe(
      'Reflected: (High) "url" in Location Header — Open Redirect'
    );
  });

  test("location header with path position has no vuln label", () => {
    const title = buildFindingTitle([{
      name: "next", matches: [[0, 1]], context: "Response Header",
      severity: "medium", confirmed: true, source: "URL",
      headers: ["Location"], redirectPosition: "path"
    }], true);
    expect(title).toBe('Reflected: (Medium) "next" in Location Header');
  });

  test("set-cookie header shows cookie injection", () => {
    const title = buildFindingTitle([{
      name: "lang", matches: [[0, 1]], context: "Response Header",
      severity: "high", confirmed: true, source: "URL",
      headers: ["Set-Cookie"]
    }], true);
    expect(title).toBe(
      'Reflected: (High) "lang" in Set-Cookie Header — Cookie Injection'
    );
  });

  test("csp header shows CSP injection", () => {
    const title = buildFindingTitle([{
      name: "src", matches: [[0, 1]], context: "Response Header",
      severity: "high", confirmed: true, source: "URL",
      headers: ["Content-Security-Policy"]
    }], true);
    expect(title).toContain("Content-Security-Policy Header");
    expect(title).toContain("CSP Injection");
  });

  test("multiple header names shown", () => {
    const title = buildFindingTitle([{
      name: "val", matches: [[0, 1]], context: "Response Header",
      severity: "medium", confirmed: true, source: "URL",
      headers: ["X-Foo", "X-Bar"]
    }], true);
    expect(title).toContain("X-Foo, X-Bar Header");
  });
});

describe("generateReport — new contexts", () => {
  test("jsUri report shows JavaScript URI assessment", () => {
    const param: any = {
      name: "q", matches: [[0, 5]], context: "jsUri",
      aggressive: ['(', ')'], source: "URL", value: "alert(1)",
      severity: "critical", confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("JavaScript URI");
    expect(out).toContain("JavaScript URI injection");
    expect(out).toContain("alert(1)//");
  });

  test("responseSplitting report shows CRLF assessment", () => {
    const param: any = {
      name: "redir", matches: [[0, 0]], context: "Response Splitting (CRLF)",
      headers: ["Location"], aggressive: ['\r', '\n'], source: "URL",
      severity: "critical", confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("Response Splitting (CRLF)");
    expect(out).toContain("CRLF injection");
  });

  test("jsTemplateLiteral with $ and { shows expression hole", () => {
    const param: any = {
      name: "t", matches: [[0, 1]], context: "jsTemplateLiteral",
      aggressive: ['$', '{'], source: "URL", value: "x",
      severity: "critical", confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("expression hole");
    expect(out).toContain("${alert(1)}");
  });

  test("importMapString shows import map assessment", () => {
    const param: any = {
      name: "mod", matches: [[0, 1]], context: "importMapString",
      aggressive: ['"'], source: "URL", severity: "high", confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("Import map injection");
    expect(out).toContain("attacker.com/malicious.js");
  });

  test("dataUri shows data URI assessment", () => {
    const param: any = {
      name: "src", matches: [[0, 1]], context: "dataUri",
      aggressive: ['<'], source: "URL", severity: "high", confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("Data URI injection");
    expect(out).toContain("data:text/html");
  });

  test("rawtextElement with closing tag shows escape payload", () => {
    const param: any = {
      name: "q", matches: [[0, 1]], context: "rawtextElement",
      aggressive: ['</textarea>', '<'], source: "URL", severity: "medium", confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("Element escape");
    expect(out).toContain("</textarea><img");
  });

  test("svgContext with < shows SVG assessment", () => {
    const param: any = {
      name: "q", matches: [[0, 1]], context: "svgContext",
      aggressive: ['<'], source: "URL", severity: "medium", confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("SVG namespace");
    expect(out).toContain("animate");
  });

  test("htmlBaseInjection with < shows base tag payload", () => {
    const param: any = {
      name: "q", matches: [[0, 1]], context: "htmlBaseInjection",
      aggressive: ['<'], source: "URL", severity: "high", confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("base");
    expect(out).toContain("<base href=");
  });

  test("domClobber shows clobbering assessment", () => {
    const param: any = {
      name: "n", matches: [[0, 1]], context: "domClobber",
      aggressive: [], source: "URL", severity: "medium", confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("DOM clobbering");
  });

  test("CSS with @ shows @-rule assessment", () => {
    const param: any = {
      name: "c", matches: [[0, 1]], context: "css",
      aggressive: ['@'], source: "URL", severity: "medium", confirmed: true
    };
    const out = generateReport(param);
    expect(out).toContain("@-rule");
    expect(out).toContain("@import");
  });
});
