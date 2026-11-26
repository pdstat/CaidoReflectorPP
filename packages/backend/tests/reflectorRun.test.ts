import { run } from "../src/reflector++.js";
import { ConfigStore } from "../src/stores/configStore.js";
import { reqParamsStore } from "../src/stores/paramStore.js";
import { SEND_TIMEOUTS } from "../src/net/probeLimiter.js";

// Each test uses its own host: the limiter singleton keeps per-domain state across tests.
const request = (host: string, query: string) => ({
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

const htmlResponse = (body: string, code = 200, headers: Record<string, string> = {}) => ({
  getCode: () => code,
  getBody: () => ({ toText: () => body }),
  getHeader: (name: string) => {
    const all: Record<string, string> = { "Content-Type": "text/html", ...headers };
    return all[name] !== undefined ? [all[name]] : undefined;
  },
  getHeaders: () => ({}),
});

// Echoes the decoded `q` value into HTML; `status` picks the probe response code.
function makeSdk(status: () => number = () => 200, headers: Record<string, string> = {}) {
  const send = jest.fn(async (spec: any, _options?: unknown) => {
    const m = String(spec.getQuery()).match(/q=([^&]*)/);
    let value = "";
    try { value = decodeURIComponent(m?.[1] ?? ""); } catch { value = m?.[1] ?? ""; }
    return { response: htmlResponse(`<p>${value}</p>`, status(), headers) };
  });
  return {
    console: { log: jest.fn(), error: jest.fn() },
    requests: { send },
    findings: { create: jest.fn(async (): Promise<undefined> => undefined) },
  };
}

beforeAll(() => {
  ConfigStore.setNoSniffContentTypes(new Set(["text/html"]));
  ConfigStore.setCheckRequestHeaderReflections(false);
  ConfigStore.setCheckPathSegmentReflections(false);
  ConfigStore.setProbeRatePerSecond(0);
});

beforeEach(() => { (reqParamsStore as any)._store = undefined; });

describe("run() probe routing", () => {
  test("every probe goes through the limiter (sent with per-probe timeouts)", async () => {
    const sdk = makeSdk();
    await run({ request: request("route.test", "q=hello"), response: htmlResponse("<input value=hello>") }, sdk);
    expect(sdk.requests.send.mock.calls.length).toBeGreaterThan(0);
    for (const call of sdk.requests.send.mock.calls) {
      expect(call[1]).toEqual({ timeouts: SEND_TIMEOUTS });
    }
    expect(sdk.findings.create).toHaveBeenCalledTimes(1);
  });
});

describe("run() when the target throttles", () => {
  test("a 429 during probing drops the scan and releases its params for retesting", async () => {
    const throttled = makeSdk(() => 429, { "Retry-After": "0" });
    const req = request("throttle.test", "q=hello");
    await run({ request: req, response: htmlResponse("<p>hello</p>") }, throttled);
    expect(throttled.findings.create).not.toHaveBeenCalled();
    expect(throttled.console.log).toHaveBeenCalledWith(expect.stringMatching(/dropped .*HTTP 429/));

    // Same request again: not deduped as already tested, so it is probed and reported.
    const healthy = makeSdk();
    await run({ request: req, response: htmlResponse("<p>hello</p>") }, healthy);
    expect(healthy.requests.send).toHaveBeenCalled();
    expect(healthy.findings.create).toHaveBeenCalledTimes(1);
  });

  test("a completed scan's params stay deduped", async () => {
    const req = request("dedupe.test", "q=hello");
    await run({ request: req, response: htmlResponse("<p>hello</p>") }, makeSdk());
    const again = makeSdk();
    await run({ request: req, response: htmlResponse("<p>hello</p>") }, again);
    expect(again.requests.send).not.toHaveBeenCalled();
  });
});

describe("run() low-severity findings toggle", () => {
  // A generic response header with CR/LF stripped: confirmed, but scored low.
  const headerEcho = (value: string) => ({
    getCode: () => 200,
    getBody: () => ({ toText: () => "<p>ok</p>" }),
    getHeader: (name: string) => (name === "Content-Type" ? ["text/html"] : undefined),
    getHeaders: () => ({ "Content-Type": ["text/html"], "X-Echo": [value.replace(/[\r\n]/g, "")] }),
  });

  function headerEchoSdk() {
    const sdk = makeSdk();
    sdk.requests.send.mockImplementation(async (spec: any) => {
      const m = String(spec.getQuery()).match(/q=([^&]*)/);
      let value = "";
      try { value = decodeURIComponent(m?.[1] ?? ""); } catch { value = m?.[1] ?? ""; }
      return { response: headerEcho(value) };
    });
    return sdk;
  }

  afterEach(() => ConfigStore.setLogLowFindings(false));

  test("is off by default: a low-only reflection creates no finding", async () => {
    expect(ConfigStore.getLogLowFindings()).toBe(false);
    const sdk = headerEchoSdk();
    await run({ request: request("low-off.test", "q=hello"), response: headerEcho("hello") }, sdk);
    expect(sdk.requests.send).toHaveBeenCalled();
    expect(sdk.findings.create).not.toHaveBeenCalled();
  });

  test("when enabled, the low reflection is reported", async () => {
    ConfigStore.setLogLowFindings(true);
    const sdk = headerEchoSdk();
    await run({ request: request("low-on.test", "q=hello"), response: headerEcho("hello") }, sdk);
    expect(sdk.findings.create).toHaveBeenCalledTimes(1);
    const finding = (sdk.findings.create.mock.calls[0] as unknown[])[0] as { description: string };
    expect(finding.description).toMatch(/"severity":\s*"low"/);
  });
});
