import { runProbes } from "../src/analysis/bodyReflection/probeRunner.js";
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

// Provide a programmable mock for PayloadGenerator.detect
let mockDetectImpl: (pre: string, ch: string, suf: string, body: string) => any[] = () => [];
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
  ConfigStore.setNoSniffContentTypes(new Set(["text/html", "application/xhtml+xml"]));
});

afterAll(() => {
  ConfigStore.setNoSniffContentTypes(new Set(originalNoSniff));
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
    expect(result).toEqual({ confirmed: false, successfulChars: new Set(), bestContext: "html", probeWasStable: false });
    expect(sdk.requests.send).not.toHaveBeenCalled();
  });

  test("Single batch success adds successful char, sets confirmed and stability", async () => {
    // Detection returns literal 'html' context so char qualifies as successful
    mockDetectImpl = (pre, ch, suf, body) => body.includes(pre + encodeURIComponent(ch) + suf) ? [{ context: 'html', char: ch }] : [];

    const baselineBody = "abc"; // contains KEY_WORD for baselineSig
    const baselineSig = KEY_WORDS_LOCAL.map(k => findMatches(baselineBody, k, true).length).join(',');

    const responseBodyNeedle = (ch: string) => "R".repeat(5) + encodeURIComponent(ch) + "R".repeat(5);
    const sdk = buildSdk(async () => ({ response: buildResponse(baselineBody + responseBodyNeedle('<')) }));

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
    expect(result.confirmed).toBe(true);
    expect(result.probeWasStable).toBe(true);
    expect(Array.from(result.successfulChars)).toEqual(["<"]);
    expect(result.bestContext).toBe("html");
  });

  test("Best context upgraded from html to jsInQuote (no successful chars due to gating)", async () => {
    mockDetectImpl = (pre, ch, suf, body) => body.includes(pre + encodeURIComponent(ch) + suf) ? [{ context: 'jsInQuote', char: ch }] : [];
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
    mockDetectImpl = (pre, ch, suf, body) => body.includes(pre + encodeURIComponent(ch) + suf) ? [{ context: 'html', char: ch }] : [];
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
});
