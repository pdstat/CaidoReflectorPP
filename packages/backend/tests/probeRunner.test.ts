import { runProbes, runCountProbe } from "../src/analysis/bodyReflection/probeRunner.js";
import { findMatches } from "../src/utils/text.js";
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
  const KEY_WORDS_LOCAL = ["abc"]; // keep simple for stability signature

  test("Early return when contextInfo has no payload", async () => {
    const sdk = buildSdk(async () => { throw new Error("should not send"); });
    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: [] },
      [],
      200,
      "0", // baselineSig
      "baseline", // bodyText
      KEY_WORDS_LOCAL,
      "html"
    );
    expect(result).toEqual({ confirmed: false, reflected: false, successfulChars: new Set(), bestContext: "html", probeWasStable: false });
    expect(sdk.requests.send).not.toHaveBeenCalled();
  });

  test("Single batch success adds successful char, sets confirmed and stability", async () => {
    // Detection returns literal 'html' context so char qualifies as successful
    mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + encodeURIComponent(ch) + suf) ? [{ context: 'html', char: ch }] : []
    );

    const baselineBody = "abc"; // contains KEY_WORD for baselineSig
    const baselineSig = KEY_WORDS_LOCAL.map(k => findMatches(baselineBody, k, true).length).join(',');

    const responseBodyNeedle = (ch: string) => "R".repeat(5) + encodeURIComponent(ch) + "R".repeat(5);
    const sdk = buildSdk(async () => ({ response: buildResponse(baselineBody + responseBodyNeedle('<')) }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["jsonString"], payload: ["<"] },
      [],
      200,
      baselineSig,
      baselineBody,
      KEY_WORDS_LOCAL,
      "html"
    );
    expect(result.confirmed).toBe(true);
    expect(result.reflected).toBe(true);
    expect(result.probeWasStable).toBe(true);
    expect(Array.from(result.successfulChars)).toEqual(["<"]);
    expect(result.bestContext).toBe("html");
  });

  test("Best context upgraded from html to jsInQuote (no successful chars due to gating)", async () => {
    mockDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + encodeURIComponent(ch) + suf) ? [{ context: 'jsInQuote', char: ch }] : []
    );
    const baselineBody = "abc";
    const baselineSig = KEY_WORDS_LOCAL.map(k => findMatches(baselineBody, k, true).length).join(',');
    const responseBodyNeedle = (ch: string) => "R".repeat(5) + encodeURIComponent(ch) + "R".repeat(5);
    const sdk = buildSdk(async () => ({ response: buildResponse(baselineBody + responseBodyNeedle('/')) }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: ["/"] },
      [],
      200,
      baselineSig,
      baselineBody,
      KEY_WORDS_LOCAL,
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
    const baselineSig = KEY_WORDS_LOCAL.map(k => findMatches(baselineBody, k, true).length).join(',');
    const firstBatch = ['a','b','c','d','e','f','g','h']; // 8 chars
    const secondBatch = ['i'];
    const allPayload = [...firstBatch, ...secondBatch];
    const needleFor = (ch: string) => "R".repeat(5) + encodeURIComponent(ch) + "R".repeat(5);
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
      [],
      200,
      baselineSig,
      baselineBody,
      KEY_WORDS_LOCAL,
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
    const baselineSig = KEY_WORDS_LOCAL.map(k => findMatches(baselineBody, k, true).length).join(',');
    // Response contains the DECODED form (pre + < + suf), not the encoded form (pre + %3C + suf)
    const decodedNeedle = "R".repeat(5) + "<" + "R".repeat(5);
    const sdk = buildSdk(async () => ({ response: buildResponse(baselineBody + decodedNeedle) }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: ["<"] },
      [],
      200,
      baselineSig,
      baselineBody,
      KEY_WORDS_LOCAL,
      "html"
    );
    expect(result.reflected).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.successfulChars.has("<")).toBe(true);
  });

  test("JSON string sealed: structural chars removed when \" and \\ escaped", async () => {
    // Simulate JSON.stringify: " and \ are NOT reflected, but , } ] : are
    const responseBodyNeedle = (ch: string) => "R".repeat(5) + encodeURIComponent(ch) + "R".repeat(5);
    jsonDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (ch === '"' || ch === '\\') return []; // escaped by server
      if (body.includes(pre + encodeURIComponent(ch) + suf))
        return [{ context: 'jsonString', char: ch }];
      return [];
    });
    const baselineBody = "abc";
    const baselineSig = KEY_WORDS_LOCAL.map(k => findMatches(baselineBody, k, true).length).join(',');
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
      [],
      200,
      baselineSig,
      baselineBody,
      KEY_WORDS_LOCAL,
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
    const responseBodyNeedle = (ch: string) => "R".repeat(5) + encodeURIComponent(ch) + "R".repeat(5);
    jsonDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (body.includes(pre + encodeURIComponent(ch) + suf))
        return [{ context: 'jsonString', char: ch }];
      return [];
    });
    const baselineBody = "abc";
    const baselineSig = KEY_WORDS_LOCAL.map(k => findMatches(baselineBody, k, true).length).join(',');
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
      [],
      200,
      baselineSig,
      baselineBody,
      KEY_WORDS_LOCAL,
      "JSON String"
    );
    expect(result.confirmed).toBe(true);
    expect(result.successfulChars.has('"')).toBe(true);
    expect(result.successfulChars.has(',')).toBe(true);
    expect(result.successfulChars.has('}')).toBe(true);
  });

  test("JSON structure context: structural chars always kept", async () => {
    const responseBodyNeedle = (ch: string) => "R".repeat(5) + encodeURIComponent(ch) + "R".repeat(5);
    jsonDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (ch === '"' || ch === '\\') return []; // even if escaped
      if (body.includes(pre + encodeURIComponent(ch) + suf))
        return [{ context: 'jsonStructure', char: ch }];
      return [];
    });
    const baselineBody = "abc";
    const baselineSig = KEY_WORDS_LOCAL.map(k => findMatches(baselineBody, k, true).length).join(',');
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
      [],
      200,
      baselineSig,
      baselineBody,
      KEY_WORDS_LOCAL,
      "JSON Structure"
    );
    // Structure context: structural chars always exploitable
    expect(result.confirmed).toBe(true);
    expect(result.successfulChars.has(',')).toBe(true);
    expect(result.successfulChars.has('}')).toBe(true);
  });

  test("jsonInQuote sealed: structural chars removed, < also absent", async () => {
    // Simulates /json-script-escaped: JSON.stringify + \u003c
    const responseBodyNeedle = (ch: string) => "R".repeat(5) + encodeURIComponent(ch) + "R".repeat(5);
    mockDetectImpl.mockImplementation((pre, ch, suf, body) => {
      if (ch === '"' || ch === '\\' || ch === '<') return []; // all escaped
      if (body.includes(pre + encodeURIComponent(ch) + suf))
        return [{ context: 'jsonInQuote', char: ch }];
      return [];
    });
    const baselineBody = "abc";
    const baselineSig = KEY_WORDS_LOCAL.map(k => findMatches(baselineBody, k, true).length).join(',');
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
      [],
      200,
      baselineSig,
      baselineBody,
      KEY_WORDS_LOCAL,
      "JSON Script Block (string)"
    );
    expect(result.successfulChars.has(',')).toBe(false);
    expect(result.successfulChars.has('}')).toBe(false);
    expect(result.confirmed).toBe(false);
  });

  test("JSON responses use JsonResponseBodyPayloadGenerator", async () => {
    const responseBodyNeedle = (ch: string) => "R".repeat(5) + encodeURIComponent(ch) + "R".repeat(5);
    mockDetectImpl.mockImplementation(() => []);
    jsonDetectImpl.mockImplementation((pre, ch, suf, body) =>
      body.includes(pre + encodeURIComponent(ch) + suf) ? [{ context: 'jsonString', char: ch }] : []
    );
    const baselineBody = "abc";
    const baselineSig = KEY_WORDS_LOCAL.map(k => findMatches(baselineBody, k, true).length).join(',');
    const sdk = buildSdk(async () => ({ response: buildResponse(baselineBody + responseBodyNeedle('<'), 200, 'application/json') }));

    const result = await runProbes(
      sdk,
      buildRequestWrapper(),
      { key: "p", source: "URL", value: "orig" },
      { context: ["html"], payload: ["<"] },
      [],
      200,
      baselineSig,
      baselineBody,
      KEY_WORDS_LOCAL,
      "html"
    );

    expect(result.bestContext).toBe("jsonString");
    expect(jsonDetectImpl).toHaveBeenCalled();
    expect(mockDetectImpl).not.toHaveBeenCalled();
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
});
