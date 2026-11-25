import { run } from "../src/reflector++.js";
import { ConfigStore } from "../src/stores/configStore.js";
import { reqParamsStore, headerParamsStore } from "../src/stores/paramStore.js";
import { UNCONFIRMED_VALUE_CAP } from "../src/core/constants.js";

// End-to-end through run(): a fake target renders each request's `q` value; we count the
// probes Reflector++ sends per request.

type Target = (value: string) => {
  body: string; headers?: Record<string, string>; code?: number; delayMs?: number;
};

const decodeQ = (query: string): string => {
  const raw = query.match(/(?:^|&)q=([^&]*)/)?.[1] ?? "";
  try { return decodeURIComponent(raw); } catch { return raw; }
};

const makeResponse = (target: Target, value: string): any => {
  const { body, headers = {}, code = 200 } = target(value);
  const all: Record<string, string> = { "Content-Type": "text/html", ...headers };
  return {
    getCode: () => code,
    getBody: () => ({ toText: () => body }),
    getHeader: (name: string) => (all[name] !== undefined ? [all[name]] : undefined),
    getHeaders: () => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, [v]])),
  };
};

const makeRequest = (host: string, query: string): any => ({
  toSpec: () => {
    let q = query;
    return {
      getQuery: () => q,
      setQuery: (v: string) => { q = v; },
      getMethod: () => "GET",
      getHeader: (): undefined => undefined,
      getHeaders: () => ({}),
      getBody: (): undefined => undefined,
      getTls: () => false,
      getHost: () => host,
      getPath: () => "/page",
    };
  },
  getMethod: () => "GET",
  getHost: () => host,
  getPath: () => "/page",
  getQuery: () => query,
  getTls: () => false,
});

function makeSdk(target: Target, failSends = false) {
  const send = jest.fn(async (spec: any, _options?: unknown) => {
    if (failSends) throw new Error("connection reset");
    const value = decodeQ(String(spec.getQuery()));
    const delayMs = target(value).delayMs ?? 0;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { response: makeResponse(target, value) };
  });
  return {
    console: { log: jest.fn(), error: jest.fn() },
    requests: { send },
    findings: { create: jest.fn(async (): Promise<undefined> => undefined) },
  };
}

// Scans one request carrying q=value; returns the probes sent and the sdk used.
async function scan(host: string, target: Target, value: string, failSends = false) {
  const sdk = makeSdk(target, failSends);
  const query = `q=${encodeURIComponent(value)}`;
  await run({ request: makeRequest(host, query), response: makeResponse(target, value) }, sdk);
  return { probes: sdk.requests.send.mock.calls.length, sdk };
}

const htmlEscape = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Reflects safely inside a quoted attribute: reflected, never confirmed.
const encodedAttr: Target = (v) => ({ body: `<html><body><input name="t" value="${htmlEscape(v)}"></body></html>` });

// Like encodedAttr, but once `sqlErrors.on`, a value with a quote yields a 200 "SQL error"
// page echoing it raw. Off while the cap fills, or the first scan's quote-carrying probes
// would already confirm the param.
const sqlErrors = { on: false };
const sqlError200: Target = (v) => (sqlErrors.on && v.includes("'")
  ? { body: `<html><body><p>SQL syntax error near '${v}'</p></body></html>` }
  : encodedAttr(v));

const capLogged = (sdk: ReturnType<typeof makeSdk>): boolean =>
  sdk.console.log.mock.calls.some(([m]) => /capped after/.test(String(m)));

beforeAll(() => {
  ConfigStore.setNoSniffContentTypes(new Set(["text/html"]));
  ConfigStore.setCheckRequestHeaderReflections(false);
  ConfigStore.setCheckPathSegmentReflections(false);
  ConfigStore.setProbeRatePerSecond(0);
});

beforeEach(() => {
  (reqParamsStore as any)._store = undefined;
  (headerParamsStore as any)._store = undefined;
});

describe("body: unconfirmed-value cap", () => {
  test(`a rotating, safely encoded value is probed for ${UNCONFIRMED_VALUE_CAP} values, then capped`, async () => {
    const counts: number[] = [];
    let logged = 0;
    for (let i = 0; i < UNCONFIRMED_VALUE_CAP + 2; i++) {
      const { probes, sdk } = await scan("cap.test", encodedAttr, `tok${i}abcdef`);
      counts.push(probes);
      if (capLogged(sdk)) logged++;
    }
    expect(counts.slice(0, UNCONFIRMED_VALUE_CAP).every((n) => n > 0)).toBe(true);
    expect(counts.slice(UNCONFIRMED_VALUE_CAP)).toEqual([0, 0]);
    expect(logged).toBe(1);
  });

  test("after the cap, a quote that lands in a new context (200 error page) is still probed and reported", async () => {
    sqlErrors.on = false;
    for (let i = 0; i < UNCONFIRMED_VALUE_CAP; i++) await scan("sqli.test", sqlError200, `money${i}x`);
    sqlErrors.on = true;
    expect((await scan("sqli.test", sqlError200, "plainval")).probes).toBe(0);
    const { probes, sdk } = await scan("sqli.test", sqlError200, "money'");
    expect(probes).toBeGreaterThan(0);
    expect(sdk.findings.create).toHaveBeenCalledTimes(1);
  });

  test("values that do not reflect never count towards the cap", async () => {
    const silentThenEcho: Target = (v) => (v.startsWith("echo")
      ? encodedAttr(v)
      : { body: "<html><body><p>nothing</p></body></html>" });
    for (let i = 0; i < UNCONFIRMED_VALUE_CAP + 2; i++) {
      expect((await scan("silent.test", silentThenEcho, `quiet${i}xyz`)).probes).toBe(0);
    }
    expect((await scan("silent.test", silentThenEcho, "echo1abcdef")).probes).toBeGreaterThan(0);
  });

  test("values whose probes failed do not count towards the cap", async () => {
    for (let i = 0; i < UNCONFIRMED_VALUE_CAP + 1; i++) {
      await scan("fail.test", encodedAttr, `tok${i}abcdef`, true);
    }
    expect((await scan("fail.test", encodedAttr, "tokfresh")).probes).toBeGreaterThan(0);
  });
});

describe("header check: dedupe and cap", () => {
  // Echoes q into X-Session only when alphanumeric; the probe canary carries special
  // characters, so the reflection never confirms.
  const alnumHeader: Target = (v) => ({
    body: "<html><body><p>ok</p></body></html>",
    headers: /^[a-z0-9]+$/i.test(v) ? { "X-Session": `s=${v}` } : {},
  });
  // Echoes anything into X-Echo: confirms on the first probe.
  const echoHeader: Target = (v) => ({ body: "<html><body><p>ok</p></body></html>", headers: { "X-Echo": v } });

  test(`a rotating unconfirmed header value is probed ${UNCONFIRMED_VALUE_CAP} times, then capped`, async () => {
    const counts: number[] = [];
    for (let i = 0; i < UNCONFIRMED_VALUE_CAP + 2; i++) {
      counts.push((await scan("hdrcap.test", alnumHeader, `sess${i}abc`)).probes);
    }
    expect(counts).toEqual([1, 1, 1, 0, 0]);
  });

  test("a confirmed header param is not re-probed for new values", async () => {
    const first = await scan("hdrok.test", echoHeader, "first1");
    expect(first.probes).toBe(1);
    expect(first.sdk.findings.create).toHaveBeenCalledTimes(1);
    expect((await scan("hdrok.test", echoHeader, "second2")).probes).toBe(0);
  });

  test("the same header value is not re-probed", async () => {
    await scan("hdrsame.test", alnumHeader, "same1abc");
    expect((await scan("hdrsame.test", alnumHeader, "same1abc")).probes).toBe(0);
  });

  test("a header confirmed in a scan that is then dropped is retested next time", async () => {
    // The header probe confirms (200); the body probes get a later 429, so the scan is
    // dropped after the header check has already recorded its confirmation.
    const throttledBody: Target = (v) => {
      if (v.startsWith("first")) return { body: `<html><body><p>${v}</p></body></html>`, headers: { "X-Echo": v } };
      if (v.includes("_HDR_CANARY_")) return { body: "ok", headers: { "X-Echo": v } };
      return { body: "busy", headers: { "Retry-After": "0" }, code: 429, delayMs: 20 };
    };
    const dropped = await scan("hdrdrop.test", throttledBody, "first1");
    expect(dropped.sdk.findings.create).not.toHaveBeenCalled();
    expect(dropped.sdk.console.log).toHaveBeenCalledWith(expect.stringMatching(/dropped .*HTTP 429/));
    expect(headerParamsStore.get().paramTested("http://hdrdrop.test/page",
      { key: "q", value: "first1", source: "URL", method: "GET", code: 200 })).toBe(false);
    expect((await scan("hdrdrop.test", echoHeader, "first1")).probes).toBeGreaterThan(0);
  });
});
