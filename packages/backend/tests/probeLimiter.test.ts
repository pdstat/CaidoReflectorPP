import {
  LIMITS,
  ProbeLimiter,
  ScanAbortedError,
  SEND_TIMEOUTS,
  parseRetryAfter,
  scanSdk,
  type Clock,
  type LimitSettings,
} from "../src/net/probeLimiter.js";

// Manual clock: timers fire only when the test advances time.
class FakeClock implements Clock {
  private t = 1_000_000;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private nextId = 1;

  now(): number { return this.t; }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void { this.timers.delete(handle as number); }

  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await flush();
      const due = [...this.timers.entries()]
        .filter(([, v]) => v.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = end;
    await flush();
  }
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

const spec = (host: string, label = "") => ({ getHost: () => host, label });

const response = (code: number, headers: Record<string, string> = {}) => ({
  response: {
    getCode: () => code,
    getHeader: (name: string) => (headers[name] !== undefined ? [headers[name]] : undefined),
  },
});

// Raw send whose requests stay in flight until the test settles them.
function controllableSend() {
  const calls: Array<{ spec: any; options: any; settle: (r: any) => void; fail: (e: unknown) => void }> = [];
  const send = jest.fn((s: any, options: any) => new Promise((resolve, reject) => {
    calls.push({ spec: s, options, settle: resolve, fail: reject });
  }));
  return { send, calls };
}

function setup(limits: LimitSettings = { concurrency: 2, rps: 0 }) {
  const clock = new FakeClock();
  const settings = { ...limits };
  const limiter = new ProbeLimiter(clock, () => settings);
  const log = jest.fn();
  return { clock, limiter, settings, log };
}

describe("ProbeLimiter concurrency and ordering", () => {
  test("never exceeds the per-domain concurrency cap", async () => {
    const { limiter, log } = setup({ concurrency: 2, rps: 0 });
    const { send, calls } = controllableSend();
    const scan = limiter.beginScan(log);
    const results = [1, 2, 3, 4, 5].map((n) => limiter.send(send, spec("a.example.com", `p${n}`), scan));
    await flush();
    expect(calls).toHaveLength(2);
    calls[0]!.settle(response(200));
    await flush();
    expect(calls).toHaveLength(3);
    for (const c of calls.slice(1)) c.settle(response(200));
    await flush();
    for (const c of calls.slice(3)) c.settle(response(200));
    await Promise.all(results);
    expect(calls).toHaveLength(5);
  });

  test("subdomains of one registrable domain share the cap; other domains do not", async () => {
    const { limiter, log } = setup({ concurrency: 1, rps: 0 });
    const { send, calls } = controllableSend();
    const scan = limiter.beginScan(log);
    void limiter.send(send, spec("api.example.co.uk"), scan);
    void limiter.send(send, spec("www.example.co.uk"), scan);
    void limiter.send(send, spec("other.org"), scan);
    await flush();
    expect(calls.map((c) => c.spec.getHost())).toEqual(["api.example.co.uk", "other.org"]);
  });

  test("queued probes run scan-first, not in arrival order", async () => {
    const { limiter, log } = setup({ concurrency: 1, rps: 0 });
    const { send, calls } = controllableSend();
    const first = limiter.beginScan(log);
    const second = limiter.beginScan(log);
    void limiter.send(send, spec("x.com", "first-1"), first);
    void limiter.send(send, spec("x.com", "second-1"), second);
    void limiter.send(send, spec("x.com", "first-2"), first);
    await flush();
    for (let i = 0; i < 3; i++) {
      calls[i]!.settle(response(200));
      await flush();
    }
    expect(calls.map((c) => c.spec.label)).toEqual(["first-1", "first-2", "second-1"]);
  });

  test("spaces dispatches by the requests-per-second cap", async () => {
    const { clock, limiter, log } = setup({ concurrency: 10, rps: 5 });
    const { send, calls } = controllableSend();
    const scan = limiter.beginScan(log);
    for (let i = 0; i < 3; i++) void limiter.send(send, spec("x.com"), scan);
    await flush();
    expect(calls).toHaveLength(1);
    await clock.advance(199);
    expect(calls).toHaveLength(1);
    await clock.advance(1);
    expect(calls).toHaveLength(2);
    await clock.advance(200);
    expect(calls).toHaveLength(3);
  });

  test("rate 0 means uncapped: only concurrency applies", async () => {
    const { limiter, log } = setup({ concurrency: 4, rps: 0 });
    const { send, calls } = controllableSend();
    const scan = limiter.beginScan(log);
    for (let i = 0; i < 4; i++) void limiter.send(send, spec("x.com"), scan);
    await flush();
    expect(calls).toHaveLength(4);
  });

  test("passes the per-probe timeouts to the raw send", async () => {
    const { limiter, log } = setup();
    const { send, calls } = controllableSend();
    void limiter.send(send, spec("x.com"), limiter.beginScan(log));
    await flush();
    expect(calls[0]!.options).toEqual({ timeouts: SEND_TIMEOUTS });
  });

  test("a failed send rejects that probe only and frees its slot", async () => {
    const { limiter, log } = setup({ concurrency: 1, rps: 0 });
    const { send, calls } = controllableSend();
    const scan = limiter.beginScan(log);
    const a = limiter.send(send, spec("x.com"), scan);
    const b = limiter.send(send, spec("x.com"), scan);
    await flush();
    calls[0]!.fail(new Error("Timeout"));
    await expect(a).rejects.toThrow("Timeout");
    await flush();
    calls[1]!.settle(response(200));
    await expect(b).resolves.toBeDefined();
    expect(scan.abortReason).toBeUndefined();
  });
});

describe("ProbeLimiter block handling", () => {
  test("429 with Retry-After aborts the scan and pauses the domain for that long", async () => {
    const { clock, limiter, log } = setup({ concurrency: 1, rps: 0 });
    const { send, calls } = controllableSend();
    const blocked = limiter.beginScan(log);
    const other = limiter.beginScan(log);
    const hit = limiter.send(send, spec("x.com"), blocked);
    const waiting = limiter.send(send, spec("x.com"), other);
    await flush();
    calls[0]!.settle(response(429, { "Retry-After": "5" }));
    await expect(hit).rejects.toBeInstanceOf(ScanAbortedError);
    expect(blocked.abortReason).toMatch(/HTTP 429/);
    await clock.advance(4_999);
    expect(calls).toHaveLength(1);
    await clock.advance(1);
    expect(calls).toHaveLength(2);
    calls[1]!.settle(response(200));
    await expect(waiting).resolves.toBeDefined();
  });

  test("without Retry-After, consecutive blocks back off 10s then 30s", async () => {
    const { clock, limiter, log } = setup({ concurrency: 1, rps: 0 });
    const { send, calls } = controllableSend();
    void limiter.send(send, spec("x.com"), limiter.beginScan(log)).catch(() => {});
    void limiter.send(send, spec("x.com"), limiter.beginScan(log)).catch(() => {});
    void limiter.send(send, spec("x.com"), limiter.beginScan(log)).catch(() => {});
    await flush();
    calls[0]!.settle(response(429));
    await clock.advance(9_999);
    expect(calls).toHaveLength(1);
    await clock.advance(1);
    expect(calls).toHaveLength(2);
    calls[1]!.settle(response(429));
    await clock.advance(29_999);
    expect(calls).toHaveLength(2);
    await clock.advance(1);
    expect(calls).toHaveLength(3);
  });

  test("503 counts as a block only when it carries Retry-After", async () => {
    const { limiter, log } = setup();
    const { send, calls } = controllableSend();
    const plain = limiter.beginScan(log);
    const p = limiter.send(send, spec("x.com"), plain);
    await flush();
    calls[0]!.settle(response(503));
    await expect(p).resolves.toBeDefined();
    expect(plain.abortReason).toBeUndefined();

    const retry = limiter.beginScan(log);
    const q = limiter.send(send, spec("x.com"), retry);
    await flush();
    calls[1]!.settle(response(503, { "Retry-After": "2" }));
    await expect(q).rejects.toBeInstanceOf(ScanAbortedError);
  });

  test("403 is not a block signal", async () => {
    const { limiter, log } = setup();
    const { send, calls } = controllableSend();
    const scan = limiter.beginScan(log);
    const p = limiter.send(send, spec("x.com"), scan);
    await flush();
    calls[0]!.settle(response(403));
    await expect(p).resolves.toBeDefined();
    expect(limiter.throttledHosts()).toEqual([]);
  });

  test("3 blocks within 2 minutes open the circuit breaker for 15 minutes", async () => {
    const { clock, limiter, log } = setup({ concurrency: 3, rps: 0 });
    const { send, calls } = controllableSend();
    for (let i = 0; i < 3; i++) void limiter.send(send, spec("x.com"), limiter.beginScan(log)).catch(() => {});
    const queuedScan = limiter.beginScan(log);
    const queued = limiter.send(send, spec("x.com"), queuedScan);
    await flush();
    for (const c of calls) c.settle(response(429, { "Retry-After": "1" }));
    await expect(queued).rejects.toBeInstanceOf(ScanAbortedError);
    expect(queuedScan.abortReason).toMatch(/circuit breaker open/);
    expect(limiter.throttledHosts()).toEqual([
      expect.objectContaining({ host: "x.com", state: "circuit-open", remainingMs: LIMITS.breakerMs }),
    ]);

    const fresh = limiter.beginScan(log);
    await expect(limiter.send(send, spec("x.com"), fresh)).rejects.toBeInstanceOf(ScanAbortedError);
    expect(calls).toHaveLength(3);

    await clock.advance(LIMITS.breakerMs);
    const after = limiter.send(send, spec("x.com"), limiter.beginScan(log));
    await flush();
    expect(calls).toHaveLength(4);
    calls[3]!.settle(response(200));
    await expect(after).resolves.toBeDefined();
  });

  test("resetHost clears a cooldown and resumes the queue", async () => {
    const { limiter, log } = setup({ concurrency: 1, rps: 0 });
    const { send, calls } = controllableSend();
    void limiter.send(send, spec("api.x.com"), limiter.beginScan(log)).catch(() => {});
    const waiting = limiter.send(send, spec("api.x.com"), limiter.beginScan(log));
    await flush();
    calls[0]!.settle(response(429, { "Retry-After": "300" }));
    await flush();
    expect(limiter.throttledHosts()[0]).toMatchObject({ host: "x.com", state: "cooldown", queued: 1 });
    expect(limiter.resetHost("x.com")).toBe(true);
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]!.settle(response(200));
    await expect(waiting).resolves.toBeDefined();
    expect(limiter.resetHost("never-seen.com")).toBe(false);
  });
});

describe("ProbeLimiter deadlines", () => {
  test("a scan still queued after the queue-wait limit is aborted", async () => {
    const { clock, limiter, log } = setup({ concurrency: 1, rps: 0 });
    const { send } = controllableSend();
    void limiter.send(send, spec("x.com"), limiter.beginScan(log));
    const starved = limiter.beginScan(log);
    const p = limiter.send(send, spec("x.com"), starved);
    const assertion = expect(p).rejects.toBeInstanceOf(ScanAbortedError);
    await clock.advance(LIMITS.queueWaitMs);
    await assertion;
    expect(starved.abortReason).toMatch(/deadline/);
  });

  test("probes sent after the scan deadline reject without reaching the network", async () => {
    const { clock, limiter, log } = setup();
    const { send, calls } = controllableSend();
    const scan = limiter.beginScan(log);
    void limiter.send(send, spec("x.com"), scan);
    await flush();
    calls[0]!.settle(response(200));
    await clock.advance(LIMITS.scanDeadlineMs);
    await expect(limiter.send(send, spec("x.com"), scan)).rejects.toBeInstanceOf(ScanAbortedError);
    expect(calls).toHaveLength(1);
  });

  test("an aborted scan's later sends reject immediately", async () => {
    const { limiter, log } = setup();
    const { send } = controllableSend();
    const scan = limiter.beginScan(log);
    scan.abortReason = "test";
    await expect(limiter.send(send, spec("x.com"), scan)).rejects.toThrow("Scan aborted: test");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  test.each([
    [["7"], 7_000],
    ["0", 0],
    ["99999", LIMITS.retryAfterCapMs],
    ["Tue, 24 Nov 2026 12:00:30 GMT", 30_000],
    ["Tue, 24 Nov 2026 11:00:00 GMT", 0],
  ])("%p -> %p ms", (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });

  test.each([undefined, "", "soon", []])("%p is not a Retry-After", (value) => {
    expect(parseRetryAfter(value, now)).toBeUndefined();
  });
});

describe("scanSdk", () => {
  test("routes requests.send through the limiter with timeouts; keeps console", async () => {
    const raw = { console: { log: jest.fn() }, requests: { send: jest.fn(async () => response(200)) } };
    const { limiter, log } = setup();
    const scan = limiter.beginScan(log);
    const sdk = scanSdk(raw, scan, limiter);
    await sdk.requests.send(spec("x.com"));
    expect(raw.requests.send).toHaveBeenCalledWith(expect.anything(), { timeouts: SEND_TIMEOUTS });
    expect(sdk.console).toBe(raw.console);
    expect(sdk.scan).toBe(scan);
  });
});
