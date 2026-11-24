import { runProbes, runCountProbe, orderPayloadBreakoutFirst } from "../src/analysis/bodyReflection/probeRunner.js";
import { ConfigStore } from "../src/stores/configStore.js";

// Mock randomValue so we get deterministic pre/suf wrappers (length param respected)
jest.mock("../src/utils/text.js", () => {
  const actual = jest.requireActual("../src/utils/text.js");
  return {
    ...actual,
    randomValue: jest.fn((len: number = 8) => "R".repeat(len))
  };
});

// Provide a programmable mock for each payload generator
let mockDetectImpl = jest.fn((pre: string, ch: string, suf: string, body: string) => []);
let jsonDetectImpl = jest.fn((pre: string, ch: string, suf: string, body: string) => []);
jest.mock("../src/payload/responseBodyPayloadGenerator.js", () => {
  return {
    __esModule: true,
    default: class MockPayloadGenerator {
      body: string;
      constructor(body: string) { this.body = body; }
      detect(_sdk: any, _opts: any, pre: string, ch: string, suf: string) {
        return mockDetectImpl(pre, ch, suf, this.body);
      }
      isInScriptOutsideString(needle: string) {
        const Real = jest.requireActual("../src/payload/responseBodyPayloadGenerator.js").default;
        return new Real(this.body).isInScriptOutsideString(needle);
      }
      isQuoteInertInScript(start: string, pre: string, ch: string, suf: string) {
        const Real = jest.requireActual("../src/payload/responseBodyPayloadGenerator.js").default;
        return new Real(this.body).isQuoteInertInScript(start, pre, ch, suf);
      }
    }
  };
});
jest.mock("../src/payload/jsonResponseBodyPayloadGenerator.js", () => {
  return {
    __esModule: true,
    default: class MockJsonPayloadGenerator {
      body: string;
      constructor(body: string) { this.body = body; }
      detect(_sdk: any, _opts: any, pre: string, ch: string, suf: string) {
        return jsonDetectImpl(pre, ch, suf, this.body);
      }
    }
  };
});

// Helper to build a minimal SDK / request / response environment
function buildSdk(sendImpl: (spec: any) => Promise<any>) {
  return {
    console: { log: jest.fn() },
    requests: { send: jest.fn(sendImpl) }
  } as any;
}

function buildRequestSpec(initialQuery = "p=orig") {
  let currentQuery = initialQuery;
  return {
    getQuery: () => currentQuery,
    setQuery: (q: string) => { currentQuery = q; },
    getBody: (): null => null,
    setBody: (_: string) => { /* noop */ },
    getHeader: (_: string): undefined => undefined
  };
}

function buildPathRequestSpec(initialPath = "/seg0/seg1") {
  let currentPath = initialPath;
  return {
    getQuery: () => "",
    setQuery: (_: string) => {},
    getPath: () => currentPath,
    setPath: (p: string) => { currentPath = p; },
    getBody: (): null => null,
    setBody: (_: string) => {},
    getHeader: (_: string): undefined => undefined
  };
}

function buildRequestWrapper(spec = buildRequestSpec()) {
  return { toSpec: () => spec };
}

function buildResponse(body: string, code = 200, ct = "text/html") {
  return {
    getHeader: (name: string) => {
      if (name.toLowerCase() === 'content-type') return ct;
      if (name.toLowerCase() === 'x-content-type-options') return undefined;
      return undefined;
    },
    getCode: () => code,
    getBody: () => ({ toText: () => body })
  };
}

let originalNoSniff: Set<string>;

beforeAll(() => {
  originalNoSniff = new Set(ConfigStore.getNoSniffContentTypes());
  ConfigStore.setNoSniffContentTypes(new Set(["text/html", "application/xhtml+xml", "application/json"]));
});

afterAll(() => {
  ConfigStore.setNoSniffContentTypes(new Set(originalNoSniff));
});

beforeEach(() => {
  mockDetectImpl.mockReset();
  mockDetectImpl.mockImplementation((pre: string, ch: string, suf: string, body: string) => []);
  jsonDetectImpl.mockReset();
  jsonDetectImpl.mockImplementation((pre: string, ch: string, suf: string, body: string) => []);
});

describe("runProbes()", () => {

  test("Early return when contextInfo has no payload", async () => {
    const sdk = buildSdk(async () => { throw new Error("should not send"); });
    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: [] },
      "html"
    );
    expect(result).toEqual({ confirmed: false, reflected: false, successfulChars: new Set(), bestContext: "html" });
    expect(sdk.requests.send).not.toHaveBeenCalled();
  });

  test("Single batch success adds successful char, sets confirmed", async () => {
    // Detection returns literal 'html' context so char qualifies as successful
    mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + encodeURIComponent(ch) + suf) ? [{ context: 'html', char: ch }] : []
    );

    const baselineBody = "abc";

    const responseBodyNeedle = (ch: string) => "R".repeat(12) + encodeURIComponent(ch) + "R".repeat(5);
    const sdk = buildSdk(async () => ({ response: buildResponse(baselineBody + responseBodyNeedle('<')) }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["jsonString"], payload: ["<"] },
      "html"
    );
    expect(result.confirmed).toBe(true);
    expect(result.reflected).toBe(true);
    expect(Array.from(result.successfulChars)).toEqual(["<"]);
    expect(result.bestContext).toBe("html");
  });

  test("Best context upgraded from html to jsInQuote (no successful chars due to gating)", async () => {
    mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + encodeURIComponent(ch) + suf) ? [{ context: 'jsInQuote', char: ch }] : []
    );
    const baselineBody = "abc";
    const responseBodyNeedle = (ch: string) => "R".repeat(12) + encodeURIComponent(ch) + "R".repeat(5);
    const sdk = buildSdk(async () => ({ response: buildResponse(baselineBody + responseBodyNeedle('/')) }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: ["/"] },
      "html"
    );
    expect(result.confirmed).toBe(true);
    expect(result.bestContext).toBe("jsInQuote"); // upgraded
    expect(result.successfulChars.size).toBe(0); // gating prevented success addition
  });

  test("Batching: second batch without reflections does not add chars", async () => {
    mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + encodeURIComponent(ch) + suf) ? [{ context: 'html', char: ch }] : []
    );
    const baselineBody = "abc";
    const firstBatch = ['a','b','c','d','e','f','g','h']; // 8 chars
    const secondBatch = ['i'];
    const allPayload = [...firstBatch, ...secondBatch];
    const needleFor = (ch: string) => "R".repeat(12) + encodeURIComponent(ch) + "R".repeat(5);
    let call = 0;
    const sdk = buildSdk(async () => {
      call++;
      if (call === 1) {
        return { response: buildResponse(baselineBody + firstBatch.map(needleFor).join('')) };
      }
      return { response: buildResponse(baselineBody) }; // no needles for second batch
    });

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: allPayload },
      "html"
    );
    expect(result.confirmed).toBe(true);
    expect(result.successfulChars.size).toBe(8); // only first batch
    expect(new Set(firstBatch).size).toBe(8);
    for (const ch of firstBatch) expect(result.successfulChars.has(ch)).toBe(true);
    expect(result.successfulChars.has('i')).toBe(false);
  });

  test("Bug #1: decoded needle found in HTML response sets reflected=true", async () => {
    // Server decodes %3C to <, so decoded needle should match even for HTML responses
    mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + ch + suf) ? [{ context: 'html', char: ch }] : []
    );
    const baselineBody = "abc";
    // Response contains the DECODED form (pre + < + suf), not the encoded form (pre + %3C + suf)
    const decodedNeedle = "R".repeat(12) + "<" + "R".repeat(5);
    const sdk = buildSdk(async () => ({ response: buildResponse(baselineBody + decodedNeedle) }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: ["<"] },
      "html"
    );
    expect(result.reflected).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.successfulChars.has("<")).toBe(true);
  });

  test("Escalates to live HTML context when the chosen context is a sealed JS string", async () => {
    // A param reflected in a fully-escaped JS string (sealed) AND raw in HTML text.
    // The ladder picks the JS string first; the live "<" in HTML must win.
    mockDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (!body.includes(pre + ch + suf)) return [];
      if (ch === "<") return [{ context: "html", char: ch }];
      return [{ context: "jsInQuote", char: ch }];
    });
    const baselineBody = "abc";
    const chars = ["<", ";", "("];
    const needle = (ch: string) => "R".repeat(12) + ch + "R".repeat(5);
    const bodyContent = baselineBody + chars.map(needle).join("");
    const sdk = buildSdk(async () => ({ response: buildResponse(bodyContent) }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["jsInQuote", "html"], payload: chars },
      "Script String (\")"
    );
    expect(result.confirmed).toBe(true);
    expect(result.bestContext).toBe("HTML");
    expect(result.successfulChars.has("<")).toBe(true);
    expect(result.successfulChars.has(";")).toBe(false);
  });

  test("Backtick in a sealed double-quoted JS string stays low, so HTML still wins", async () => {
    // A backtick is only a breakout in an UNQUOTED JS string. The chosen context label
    // carries its enclosing quote ("), so the backtick is inert and the context is low;
    // the live "<" in HTML must still out-rank it. Guards against re-prettifying the
    // chosen label (which would drop the quote and misread the backtick as a breakout).
    mockDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (!body.includes(pre + ch + suf)) return [];
      if (ch === "<") return [{ context: "html", char: ch }];
      return [{ context: "jsInQuote", char: ch }];
    });
    const baselineBody = "abc";
    const chars = ["<", "`"];
    const needle = (ch: string) => "R".repeat(12) + ch + "R".repeat(5);
    const bodyContent = baselineBody + chars.map(needle).join("");
    const sdk = buildSdk(async () => ({ response: buildResponse(bodyContent) }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["jsInQuote", "html"], payload: chars },
      "Script String (\")"
    );
    expect(result.confirmed).toBe(true);
    expect(result.bestContext).toBe("HTML");
    expect(result.successfulChars.has("<")).toBe(true);
    expect(result.successfulChars.has("`")).toBe(false);
  });

  test("Does not escalate when the live HTML char does not out-rank the chosen context", async () => {
    // "<" only reflects inside a rawtext element where it cannot open a tag (low),
    // while the chosen JS (non-string) context is high -> no escalation.
    mockDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (!body.includes(pre + ch + suf)) return [];
      if (ch === "<") return [{ context: "rawtextElement", char: ch }];
      return [{ context: "js", char: ch }];
    });
    const baselineBody = "abc";
    const chars = ["<", "a"];
    const needle = (ch: string) => "R".repeat(12) + ch + "R".repeat(5);
    const bodyContent = baselineBody + chars.map(needle).join("");
    const sdk = buildSdk(async () => ({ response: buildResponse(bodyContent) }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["js", "rawtextElement"], payload: chars },
      "Script"
    );
    expect(result.confirmed).toBe(true);
    expect(result.bestContext).toBe("Script");
  });

  test("JSON string sealed: structural chars removed when \" and \\ escaped", async () => {
    // Simulate JSON.stringify: " and \ are NOT reflected, but , } ] : are
    const responseBodyNeedle = (ch: string) => "R".repeat(12) + encodeURIComponent(ch) + "R".repeat(5);
    jsonDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (ch === '"' || ch === '\\') return []; // escaped by server
      if (body.includes(pre + encodeURIComponent(ch) + suf))
        return [{ context: 'jsonString', char: ch }];
      return [];
    });
    const baselineBody = "abc";
    const allChars = ['"', '\\', ',', '}', ']', ':', ''];
    const bodyContent = baselineBody + allChars
      .filter(ch => ch !== '"' && ch !== '\\')
      .map(ch => responseBodyNeedle(ch)).join('');
    const sdk = buildSdk(async () => ({
      response: buildResponse(bodyContent, 200, 'application/json')
    }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["jsonString"], payload: allChars },
      "JSON String"
    );
    // Structural chars removed because quote breakout impossible
    expect(result.successfulChars.has(',')).toBe(false);
    expect(result.successfulChars.has('}')).toBe(false);
    expect(result.successfulChars.has(']')).toBe(false);
    expect(result.successfulChars.has(':')).toBe(false);
    // Only alphanumeric (empty) may remain
    expect(result.confirmed).toBe(false);
  });

  test("JSON string NOT sealed: structural chars kept when \" reflects", async () => {
    const responseBodyNeedle = (ch: string) => "R".repeat(12) + encodeURIComponent(ch) + "R".repeat(5);
    jsonDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (body.includes(pre + encodeURIComponent(ch) + suf))
        return [{ context: 'jsonString', char: ch }];
      return [];
    });
    const baselineBody = "abc";
    const allChars = ['"', ',', '}'];
    const bodyContent = baselineBody + allChars.map(ch => responseBodyNeedle(ch)).join('');
    const sdk = buildSdk(async () => ({
      response: buildResponse(bodyContent, 200, 'application/json')
    }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["jsonString"], payload: allChars },
      "JSON String"
    );
    expect(result.confirmed).toBe(true);
    expect(result.successfulChars.has('"')).toBe(true);
    expect(result.successfulChars.has(',')).toBe(true);
    expect(result.successfulChars.has('}')).toBe(true);
  });

  test("JSON structure context: structural chars always kept", async () => {
    const responseBodyNeedle = (ch: string) => "R".repeat(12) + encodeURIComponent(ch) + "R".repeat(5);
    jsonDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (ch === '"' || ch === '\\') return []; // even if escaped
      if (body.includes(pre + encodeURIComponent(ch) + suf))
        return [{ context: 'jsonStructure', char: ch }];
      return [];
    });
    const baselineBody = "abc";
    const allChars = ['"', '\\', ',', '}'];
    const bodyContent = baselineBody + [',', '}'].map(ch => responseBodyNeedle(ch)).join('');
    const sdk = buildSdk(async () => ({
      response: buildResponse(bodyContent, 200, 'application/json')
    }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["jsonStructure"], payload: allChars },
      "JSON Structure"
    );
    // Structure context: structural chars always exploitable
    expect(result.confirmed).toBe(true);
    expect(result.successfulChars.has(',')).toBe(true);
    expect(result.successfulChars.has('}')).toBe(true);
  });

  test("jsonInQuote sealed: structural chars removed, < also absent", async () => {
    // Simulates /json-script-escaped: JSON.stringify + \u003c
    const responseBodyNeedle = (ch: string) => "R".repeat(12) + encodeURIComponent(ch) + "R".repeat(5);
    mockDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (ch === '"' || ch === '\\' || ch === '<') return []; // all escaped
      if (body.includes(pre + encodeURIComponent(ch) + suf))
        return [{ context: 'jsonInQuote', char: ch }];
      return [];
    });
    const baselineBody = "abc";
    const allChars = ['"', '\\', '<', ',', '}', ']', ':', ''];
    const bodyContent = baselineBody + [',', '}', ']', ':', '']
      .map(ch => responseBodyNeedle(ch)).join('');
    const sdk = buildSdk(async () => ({
      response: buildResponse(bodyContent, 200, 'text/html')
    }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["jsonInQuote"], payload: allChars },
      "JSON Script Block (string)"
    );
    expect(result.successfulChars.has(',')).toBe(false);
    expect(result.successfulChars.has('}')).toBe(false);
    expect(result.confirmed).toBe(false);
  });

  test("JSON responses use JsonResponseBodyPayloadGenerator", async () => {
    const responseBodyNeedle = (ch: string) => "R".repeat(12) + encodeURIComponent(ch) + "R".repeat(5);
    mockDetectImpl.mockImplementation(() => []);
    jsonDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + encodeURIComponent(ch) + suf) ? [{ context: 'jsonString', char: ch }] : []
    );
    const baselineBody = "abc";
    const sdk = buildSdk(async () => ({ response: buildResponse(baselineBody + responseBodyNeedle('<'), 200, 'application/json') }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: ["<"] },
      "html"
    );

    expect(result.bestContext).toBe("jsonString");
    expect(jsonDetectImpl).toHaveBeenCalled();
    expect(mockDetectImpl).not.toHaveBeenCalled();
  });

  test("Error-gated reflection: tag chars detected when a quote truncates the echo", async () => {
    // Models an endpoint that echoes input ONLY inside a MariaDB syntax error, and only
    // when the value contains a "'" (otherwise a non-reflecting page is returned). The
    // error reflects just the text AFTER the breaking quote ("...near '<rest>'"), so any
    // char probed before the quote in the shared blob is invisible. The HTML payload list
    // places "'" before "<"/">", which hid tag injection until breakout chars were probed
    // first. Mirrors westernunionshop.com/_JSCRIPTS/productsearch.php?qs=.
    mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + ch + suf) ? [{ context: 'html', char: ch }] : []
    );
    const sdk = buildSdk(async (spec: any) => {
      const q: string = spec.getQuery();
      const decoded = decodeURIComponent(q.slice(q.indexOf('=') + 1));
      const qi = decoded.indexOf("'");
      // No quote => no SQL error => non-reflecting page.
      const echoed = qi === -1 ? '' : decoded.slice(qi + 1);
      return { response: buildResponse(`err near '${echoed}'`) };
    });

    // HTML text payload set exactly as generated for this context.
    const htmlPayload = ['<', '>', '"', "'", '/', ';', ''];
    const result = await runProbes(
      sdk,
      buildRequestWrapper(buildRequestSpec("qs=init")),
      { key: "qs", source: "URL", value: "money'" },
      { context: ["html"], payload: htmlPayload },
      "html"
    );
    expect(result.confirmed).toBe(true);
    // The security-relevant outcome: tag injection chars are now detected.
    expect(result.successfulChars.has('<')).toBe(true);
    expect(result.successfulChars.has('>')).toBe(true);
    // Chars after the breaking quote also surface.
    expect(result.successfulChars.has('"')).toBe(true);
    expect(result.successfulChars.has('/')).toBe(true);
  });

  test("non-literal (escaped) detection yields no successful char (demotion happens downstream)", async () => {
    // Escaped-endpoint pattern: the probe char reflects but only in an escaped/non-literal
    // context, so no breakout char is harvested. runProbes reports reflected=true with an
    // empty successfulChars set; the confirmed->unconfirmed demotion for such cases is done
    // in bodyReflection using the computed severity, not here.
    mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + encodeURIComponent(ch) + suf)
        ? [{ context: 'attributeEscaped', char: ch }] : []
    );
    const baselineBody = "abc";
    const needle = (ch: string) => "R".repeat(12) + encodeURIComponent(ch) + "R".repeat(5);
    const sdk = buildSdk(async () => ({ response: buildResponse(baselineBody + needle('"')) }));
    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["attributeInQuote"], payload: ['"'] },
      'Tag Attribute (") Value'
    );
    expect(result.reflected).toBe(true);         // the char did reflect
    expect(result.successfulChars.size).toBe(0); // but no literal breakout char harvested
  });

  test("Path source: breakout char injected raw (no double-encode) is detected", async () => {
    // Regression for the Path double-encode bug: probeRunner must inject the char RAW and let
    // mutateParamValue apply the single path encodeURIComponent. The server (Express) then decodes
    // once, so the char reflects raw. Before the fix the char was encoded twice (%253C) and never
    // reflected raw, silently downgrading severity.
    mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + ch + suf) ? [{ context: 'html', char: ch }] : []
    );
    const baselineBody = "abc";
    const sdk = buildSdk(async (spec: any) => {
      // Simulate Express decoding the path segment exactly once.
      const seg = spec.getPath().split('/').pop() as string;
      const decodedOnce = decodeURIComponent(seg);
      return { response: buildResponse(baselineBody + decodedOnce) };
    });
    const result = await runProbes(
      sdk,
      { toSpec: () => buildPathRequestSpec("/seg0/seg1") },
      { key: "path:1:seg1", source: "Path", value: "seg1" },
      { context: ["html"], payload: ["<"] },
      "html"
    );
    expect(result.confirmed).toBe(true);
    expect(result.successfulChars.has('<')).toBe(true);
  });

  describe("backslash+quote combo probe", () => {
    // Server reflects the decoded "p" value into a double-quoted inline-script string.
    function scriptSdk(transform: (v: string) => string, fail?: (v: string) => boolean) {
      return buildSdk(async (spec: any) => {
        const v = decodeURIComponent((spec.getQuery() as string).replace(/^p=/, ""));
        if (fail?.(v)) throw new Error("network");
        return { response: buildResponse(`abc<script>var x="${transform(v)}";</script>`) };
      });
    }

    async function probeBackslash(sdk: any) {
      mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
        body.includes(pre + ch + suf) ? [{ context: "jsInQuote", char: ch }] : []
      );
      return runProbes(
        sdk,
        buildRequestWrapper(buildRequestSpec()),
        { key: "p", source: "URL", value: "orig" },
        { context: ["jsInQuote"], payload: ["\\", '"', "'"] },
        "Script String (\")"
      );
    }

    // A lone "\" reaches the per-char check either raw (the flawed server below) or, for
    // a properly escaping nested serializer, as a doubled copy the detector also accepts.
    // Model the per-char probe seeing "\" by leaving a lone "\" raw unless it precedes '"'.
    const escapesQuoteOnly = (v: string) => v.replace(/"/g, '\\"');
    const escapesBoth = (v: string) => v.replace(/\\(?=")/g, "\\\\").replace(/"/g, '\\"');

    test("adds the quote when \\\" defeats quote-only escaping", async () => {
      const result = await probeBackslash(scriptSdk(escapesQuoteOnly));
      expect(result.successfulChars.has('"')).toBe(true);
      expect(result.successfulChars.has("\\")).toBe(true);
    });

    test("drops \\ when the combo stays sealed inside the string", async () => {
      const result = await probeBackslash(scriptSdk(escapesBoth));
      expect(result.confirmed).toBe(true);
      expect(result.successfulChars.has("\\")).toBe(false);
      expect(result.successfulChars.has('"')).toBe(false);
      // "'" sits inside the server's own "-string: inert (foreign-quote rule).
      expect(result.successfulChars.has("'")).toBe(false);
    });

    test("keeps \\ when the combo response lacks the markers (blocked)", async () => {
      const sdk = scriptSdk(v => (v.includes('\\"') ? "" : escapesBoth(v)));
      const result = await probeBackslash(sdk);
      expect(result.successfulChars.has("\\")).toBe(true);
    });

    test("keeps \\ when the combo probe throws", async () => {
      const sdk = scriptSdk(escapesBoth, v => v.includes('\\"'));
      const result = await probeBackslash(sdk);
      expect(result.successfulChars.has("\\")).toBe(true);
    });
  });

  describe("foreign-quote JS string", () => {
    // randomValue is mocked to "R".repeat(n), so every marker shares the prefix "RRRRR".
    async function probeQuotes(wrap: (v: string) => string, label: string) {
      mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
        body.includes(pre + ch + suf) ? [{ context: "jsInQuote", char: ch }] : []
      );
      const sdk = buildSdk(async (spec: any) => {
        const v = decodeURIComponent((spec.getQuery() as string).replace(/^p=/, ""));
        return { response: buildResponse(`abc<script>${wrap(v)}</script>`) };
      });
      return runProbes(
        sdk, buildRequestWrapper(buildRequestSpec()), { key: "p", source: "URL", value: "orig" },
        { context: ["jsInQuote"], payload: ["'", "("] }, label
      );
    }

    test("drops ' reflected inside a pre-existing double-quoted string", async () => {
      const result = await probeQuotes(v => `var h = "<a href=\\"/s?oq=${v}\\">x</a>";`, "Script String (')");
      expect(result.successfulChars.has("'")).toBe(false);
      expect(result.successfulChars.has("(")).toBe(true);
    });

    test("keeps ' that closes its own single-quoted string", async () => {
      const result = await probeQuotes(v => `var q = '${v}';`, "Script String (')");
      expect(result.successfulChars.has("'")).toBe(true);
    });
  });

  describe("script-close combo probe", () => {
    // Simulates a server that reflects the decoded "p" value through `transform`.
    function reflectingSdk(transform: (v: string) => string) {
      return buildSdk(async (spec: any) => {
        const raw = (spec.getQuery() as string).replace(/^p=/, "");
        return { response: buildResponse("abc" + transform(decodeURIComponent(raw))) };
      });
    }

    async function probeScriptString(sdk: any, context = "Script String (\")") {
      mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
        body.includes(pre + ch + suf) ? [{ context: "jsInQuote", char: ch }] : []
      );
      return runProbes(
        sdk,
        buildRequestWrapper(buildRequestSpec()),
        { key: "p", source: "URL", value: "orig" },
        { context: ["jsInQuote"], payload: ["<", "/", "'"] },
        context
      );
    }

    test("drops < when the server escapes the </ sequence (Marko-style \\u003C/)", async () => {
      const sdk = reflectingSdk(v => v.replace(/<\//g, "\\u003C/"));
      const result = await probeScriptString(sdk);
      expect(result.confirmed).toBe(true);
      expect(result.successfulChars.has("<")).toBe(false);
      expect(result.successfulChars.has("/")).toBe(true);
      expect(result.successfulChars.has("'")).toBe(true);
    });

    test("drops < when the server escapes / (json_encode-style <\\/)", async () => {
      const sdk = reflectingSdk(v => v.replace(/\//g, "\\/"));
      const result = await probeScriptString(sdk);
      expect(result.successfulChars.has("<")).toBe(false);
    });

    test("keeps < when </script> reflects literally", async () => {
      const sdk = reflectingSdk(v => v);
      const result = await probeScriptString(sdk);
      expect(result.successfulChars.has("<")).toBe(true);
      expect(result.successfulChars.has("/")).toBe(true);
    });

    test("keeps < when the combo probe is blocked (markers absent)", async () => {
      const sdk = reflectingSdk(v => (v.includes("</script>") ? "" : v));
      const result = await probeScriptString(sdk);
      expect(result.successfulChars.has("<")).toBe(true);
    });

    test("keeps < when the combo probe throws", async () => {
      const sdk = buildSdk(async (spec: any) => {
        const raw = decodeURIComponent((spec.getQuery() as string).replace(/^p=/, ""));
        if (raw.includes("</script>")) throw new Error("network");
        return { response: buildResponse("abc" + raw) };
      });
      const result = await probeScriptString(sdk);
      expect(result.successfulChars.has("<")).toBe(true);
    });

    test("is not sent for an HTML context", async () => {
      mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
        body.includes(pre + ch + suf) ? [{ context: "html", char: ch }] : []
      );
      const sdk = reflectingSdk(v => v.replace(/<\//g, "&lt;/"));
      const result = await runProbes(
        sdk,
        buildRequestWrapper(buildRequestSpec()),
        { key: "p", source: "URL", value: "orig" },
        { context: ["html"], payload: ["<", "/"] },
        "html"
      );
      expect(result.successfulChars.has("<")).toBe(true);
      expect(sdk.requests.send).toHaveBeenCalledTimes(1);
    });
  });
});

describe("orderPayloadBreakoutFirst()", () => {
  test("moves string terminators to the front in priority order, stably", () => {
    expect(orderPayloadBreakoutFirst(['<', '>', '"', "'", '/', ';', '']))
      .toEqual(["'", '"', '<', '>', '/', ';', '']);
  });

  test("backslash and backtick outrank quotes; non-terminators keep order", () => {
    expect(orderPayloadBreakoutFirst([';', '`', '<', "'", '\\', '>']))
      .toEqual(['\\', "'", '`', ';', '<', '>']);
  });

  test("no terminators present is a no-op", () => {
    expect(orderPayloadBreakoutFirst(['<', '>', '/', ';']))
      .toEqual(['<', '>', '/', ';']);
  });
});

describe("runProbes() first-batch count", () => {
  // randomValue is mocked to "R".repeat(len): the first batch's leading marker is 12 R's.
  const countMarker = "R".repeat(12);

  test("counts the leading marker's reflections and records the status", async () => {
    const body = `<p>${countMarker}x</p><p>${countMarker}y</p>`;
    const sdk = buildSdk(async () => ({ response: buildResponse(body, 200) }));
    const result = await runProbes(
      sdk, buildRequestWrapper(), { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: ["<"] }, "html"
    );
    expect(result.firstBatchCount).toEqual({
      matches: [[3, 15], [23, 35]], value: countMarker, code: 200,
    });
  });

  test("is taken from the first batch only, even when it fails the content-type gate", async () => {
    const payload = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    let call = 0;
    const sdk = buildSdk(async () => {
      call++;
      return { response: buildResponse(call === 1 ? countMarker : "", 302, "image/png") };
    });
    const result = await runProbes(
      sdk, buildRequestWrapper(), { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload }, "html"
    );
    expect(sdk.requests.send).toHaveBeenCalledTimes(2);
    expect(result.firstBatchCount?.matches).toHaveLength(1);
    expect(result.firstBatchCount?.code).toBe(302);
  });

  test("is absent when the first batch request throws", async () => {
    const sdk = buildSdk(async () => { throw new Error("network fail"); });
    const result = await runProbes(
      sdk, buildRequestWrapper(), { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: ["<"] }, "html"
    );
    expect(result.firstBatchCount).toBeUndefined();
  });
});

describe("runCountProbe()", () => {
  test("returns matches and marker value when probe reflects", async () => {
    const marker = "R".repeat(12);
    const responseBody = `<html><p>${marker}</p><p>${marker}</p></html>`;
    const sdk = buildSdk(async () => ({
      response: buildResponse(responseBody)
    }));
    const result = await runCountProbe(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" }
    );
    expect(result).toBeDefined();
    expect(result!.matches).toHaveLength(2);
    expect(result!.value).toBe(marker);
  });

  test("returns zero matches when probe value not reflected", async () => {
    const sdk = buildSdk(async () => ({
      response: buildResponse("<html>no reflection</html>")
    }));
    const result = await runCountProbe(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" }
    );
    expect(result).toBeDefined();
    expect(result!.matches).toHaveLength(0);
  });

  test("returns undefined on network error", async () => {
    const sdk = buildSdk(async () => { throw new Error("network fail"); });
    const result = await runCountProbe(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" }
    );
    expect(result).toBeUndefined();
  });

  test("path param: marker URL-encoded in path, found decoded in body", async () => {
    const marker = "R".repeat(12);
    const responseBody = `<script>var u="/cgi/${marker}/page";</script>`;
    const spec = buildPathRequestSpec("/cgi/original/page");
    const sdk = buildSdk(async () => ({
      response: buildResponse(responseBody)
    }));
    const result = await runCountProbe(
      sdk,
      { toSpec: () => spec },
      { key: "path:1:original", source: "Path", value: "original" }
    );
    expect(result).toBeDefined();
    expect(result!.matches).toHaveLength(1);
    expect(result!.value).toBe(marker);
  });

  test("path param: static content has fewer marker matches than baseline value", async () => {
    const marker = "R".repeat(12);
    const responseBody = `<script>var a="/cgi/${marker}/p"; var b="/cgi/original/x"; var c="/cgi/original/y";</script>`;
    const spec = buildPathRequestSpec("/cgi/original/page");
    const sdk = buildSdk(async () => ({
      response: buildResponse(responseBody)
    }));
    const result = await runCountProbe(
      sdk,
      { toSpec: () => spec },
      { key: "path:1:original", source: "Path", value: "original" }
    );
    expect(result).toBeDefined();
    expect(result!.matches).toHaveLength(1);
  });
});
