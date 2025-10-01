import { sendProbe, modifyAmbiguousParameters } from "../src/analysis/bodyReflection/probes.js";
import { RequestParameter } from "../src/core/types.js";

// Helper to craft a minimal request spec with mutable query/cookie/body
function makeRequestSpec(opts: { query?: string; cookie?: string; body?: string }) {
  let q = opts.query ?? "";
  let cookie = opts.cookie ?? "";
  let bodyText = opts.body ?? "";
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  return {
    getQuery: () => q,
    setQuery: (nv: string) => { q = nv; },
    getHeader: (name: string) => {
      if (name === "Cookie") return [headers["Cookie"]].filter(Boolean);
      if (name === "Content-Type") return ["application/x-www-form-urlencoded"];
      return undefined;
    },
    setHeader: (name: string, value: string) => { headers[name] = value; },
    getBody: () => ({ toText: () => bodyText }),
    setBody: (nv: string) => { bodyText = nv; },
  };
}

function makeResponse(body: string, code = 200) {
  return {
    getBody: () => ({ toText: () => body }),
    getCode: () => code,
    getHeader: (h: string) => (h === "Content-Type" ? "text/html" : undefined)
  };
}

describe("sendProbe", () => {
  test("mutates URL, Cookie, and Body parameters", async () => {
    const spec = makeRequestSpec({ query: "a=1", cookie: "sid=old; other=1", body: "foo=bar&x=y" });
    const params: RequestParameter[] = [
      { key: "a", value: "NEW", source: "URL", method: "GET", code: 200 },
      { key: "sid", value: "SESSION", source: "Cookie", method: "GET", code: 200 },
      { key: "foo", value: "ZZ", source: "Body", method: "POST", code: 200 }
    ];
    const sent: any[] = [];
    const sdk = {
      console: { log: () => {} },
  requests: { send: async (s: any) => { sent.push({ query: s.getQuery(), cookie: s.getHeader("Cookie"), body: s.getBody().toText() }); return { response: makeResponse("", 200) }; } }
    } as any;
    await sendProbe(sdk, spec, params);
    expect(sent).toHaveLength(1);
    const snap = sent[0];
    expect(snap.query).toBe("a=NEW");
    // Cookie order preserved except replaced value
    expect((snap.cookie as any)[0]).toContain("sid=SESSION");
    expect(snap.body).toContain("foo=ZZ");
  });
});

describe("modifyAmbiguousParameters", () => {
  const KEYWORDS_BODY = '","<script<div""[]'; // contains each KEY_WORDS once

  test("returns original when no ambiguous params", async () => {
    const input = {
      request: { toSpec: () => makeRequestSpec({ query: "param=value" }) },
      response: makeResponse(KEYWORDS_BODY, 200)
    } as any;
    const params: RequestParameter[] = [ { key: "param", value: "value", source: "URL", method: "GET", code: 200 } ];
    const sdk = { console: { log: () => {} }, requests: { send: async () => ({ response: makeResponse(KEYWORDS_BODY, 200) }) } } as any;
    const [updatedInput, newParams] = await modifyAmbiguousParameters(sdk, input, params);
    expect(updatedInput).toBe(input); // unchanged
    expect(newParams[0].value).toBe("value");
  });

  test("bulk stabilization path updates all ambiguous params", async () => {
    const input = {
      request: { toSpec: () => makeRequestSpec({ query: "a=1&b=2" }) },
      response: makeResponse(KEYWORDS_BODY, 200)
    } as any;
    const params: RequestParameter[] = [
      { key: "a", value: "x", source: "URL", method: "GET", code: 200 },
      { key: "b", value: "y", source: "URL", method: "GET", code: 200 }
    ];
    const sdk = { console: { log: () => {} }, requests: { send: async () => ({ response: makeResponse(KEYWORDS_BODY, 200) }) } } as any;
    const [updatedInput, newParams] = await modifyAmbiguousParameters(sdk, input, params);
    // Input replaced with bulk probe response (not strictly asserting identity; ensure values changed)
    expect(updatedInput).not.toBe(input);
    for (const p of newParams) {
      expect(p.value).toBeDefined();
      expect((p.value as string).length).toBeGreaterThan(2); // randomized length 8
    }
  });

  test("fallback per-parameter stabilization when bulk unstable", async () => {
    // Sequence: bulk (unstable body with duplicate '<div') -> first param stable -> second param unstable
    // We append another '<div' to alter KEY_WORDS signature counts (second occurrence of '<div').
    const unstableBody = KEYWORDS_BODY + "<div"; // causes '<div' count mismatch vs baseline
    const stableResp = { response: makeResponse(KEYWORDS_BODY, 200) };
    const unstableResp = { response: makeResponse(unstableBody, 200) };
    const sendSequence = [ unstableResp, stableResp, unstableResp ];
    const sdk = {
      console: { log: () => {} },
      requests: { send: jest.fn(async () => sendSequence.shift()) }
    } as any;
    const input = { request: { toSpec: () => makeRequestSpec({ query: "a=1&b=2" }) }, response: makeResponse(KEYWORDS_BODY, 200) } as any;
    const params: RequestParameter[] = [
      { key: "a", value: "k", source: "URL", method: "GET", code: 200 },
      { key: "b", value: "q", source: "URL", method: "GET", code: 200 }
    ];
    const [updatedInput, newParams] = await modifyAmbiguousParameters(sdk, input, params);
    // First ambiguous param should be updated (randomized value) second remains original (since unstable)
    expect(newParams[0].value).not.toBe("k");
    expect(newParams[1].value).toBe("q");
    // Updated input should be the stable probe response for first param (not original)
    expect(updatedInput).not.toBe(input);
  });
});
