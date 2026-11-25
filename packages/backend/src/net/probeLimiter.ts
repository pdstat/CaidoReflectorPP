import { hostKey } from "./hostKey.js";
import { ConfigStore } from "../stores/configStore.js";

// Every probe the plugin sends goes through ProbeLimiter, which shares limits per
// registrable domain across all concurrent scans: at most `concurrency` probes in flight
// and at most `rps` dispatches per second (0 = uncapped). Queued probes run scan-first
// (lower scan id first) so each scan finishes, and produces its finding, as early as
// possible. A 429, or a 503 with Retry-After, pauses the domain; repeated block signals
// trip a circuit breaker. A scan that hits a block, a deadline or an open breaker is
// aborted: every further send for it rejects with ScanAbortedError.

export const LIMITS = {
  queueWaitMs: 5 * 60_000,
  scanDeadlineMs: 90_000,
  retryAfterCapMs: 5 * 60_000,
  backoffMs: [10_000, 30_000, 90_000],
  breakerWindowMs: 2 * 60_000,
  breakerThreshold: 3,
  breakerMs: 15 * 60_000,
};

// Per-probe timeouts passed to sdk.requests.send. A timed-out probe rejects like any
// other failed send; it is not treated as a block signal.
export const SEND_TIMEOUTS = { connect: 10_000, response: 15_000, global: 20_000 };

export class ScanAbortedError extends Error {
  constructor(readonly reason: string) {
    super(`Scan aborted: ${reason}`);
    this.name = "ScanAbortedError";
  }
}

export function isScanAborted(e: unknown): e is ScanAbortedError {
  return e instanceof ScanAbortedError;
}

type Log = (msg: string) => void;
type RawSend = (spec: any, options: { timeouts: typeof SEND_TIMEOUTS }) => Promise<any>;

export interface Scan {
  readonly id: number;
  readonly startedAt: number;
  readonly log: Log;
  // Run by the scan's owner when the scan is aborted, to undo state it recorded as if
  // the scan would finish (e.g. params marked as tested).
  readonly onAbort: Array<() => void>;
  firstDispatchAt?: number;
  abortReason?: string;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LimitSettings {
  concurrency: number;
  rps: number;
}

export interface ThrottledHost {
  host: string;
  state: "cooldown" | "circuit-open";
  remainingMs: number;
  queued: number;
  inFlight: number;
  recentBlocks: number;
}

interface Pending {
  scan: Scan;
  seq: number;
  spec: any;
  rawSend: RawSend;
  timer?: unknown;
  resolve: (value: any) => void;
  reject: (reason: unknown) => void;
}

interface HostState {
  key: string;
  inFlight: number;
  queue: Pending[];
  nextDispatchAt: number;
  cooldownUntil: number;
  breakerUntil: number;
  blockTimes: number[];
  consecutiveBlocks: number;
  wakeTimer?: unknown;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const configLimits = (): LimitSettings => ({
  concurrency: ConfigStore.getProbeConcurrency(),
  rps: ConfigStore.getProbeRatePerSecond(),
});

/**
 * Parses a Retry-After header value (delta-seconds or an HTTP date).
 *
 * Returns:
 *   Milliseconds to wait, clamped to [0, LIMITS.retryAfterCapMs], or undefined when the
 *   header is absent or unparseable.
 */
export function parseRetryAfter(value: unknown, now: number): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const trimmed = raw.trim();
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - now;
  if (Number.isNaN(ms)) return undefined;
  return Math.min(Math.max(ms, 0), LIMITS.retryAfterCapMs);
}

interface BlockSignal {
  code: number;
  retryAfterMs: number | undefined;
}

function blockSignal(result: any, now: number): BlockSignal | undefined {
  const code = result?.response?.getCode?.() ?? 0;
  const retryAfter = result?.response?.getHeader?.("Retry-After");
  const retryAfterMs = parseRetryAfter(retryAfter, now);
  if (code === 429) return { code, retryAfterMs };
  if (code === 503 && retryAfterMs !== undefined) return { code, retryAfterMs };
  return undefined;
}

export class ProbeLimiter {
  private hosts = new Map<string, HostState>();
  private nextScanId = 1;
  private nextSeq = 1;

  constructor(
    private readonly clock: Clock = realClock,
    private readonly limits: () => LimitSettings = configLimits,
  ) {}

  beginScan(log: Log): Scan {
    return { id: this.nextScanId++, startedAt: this.clock.now(), log, onAbort: [] };
  }

  /**
   * Queues one probe for `spec`'s domain and sends it when the domain's limits allow.
   *
   * Raises:
   *   ScanAbortedError: the scan was aborted, its deadline passed, the domain's circuit
   *     breaker is open, or this probe was answered with a block signal.
   */
  send(rawSend: RawSend, spec: any, scan: Scan): Promise<any> {
    if (scan.abortReason) return Promise.reject(new ScanAbortedError(scan.abortReason));
    const state = this.stateFor(hostKey(String(spec.getHost?.() ?? "")));
    if (state.breakerUntil > this.clock.now()) {
      return Promise.reject(this.abort(state, scan, `circuit breaker open for ${state.key}`));
    }
    return new Promise((resolve, reject) => {
      const entry: Pending = { scan, seq: this.nextSeq++, spec, rawSend, resolve, reject };
      this.enqueue(state, entry);
      this.pump(state);
    });
  }

  /** Domains currently cooling down or with an open circuit breaker. */
  throttledHosts(): ThrottledHost[] {
    const now = this.clock.now();
    const out: ThrottledHost[] = [];
    for (const s of this.hosts.values()) {
      const open = s.breakerUntil > now;
      if (!open && s.cooldownUntil <= now) continue;
      out.push({
        host: s.key,
        state: open ? "circuit-open" : "cooldown",
        remainingMs: (open ? s.breakerUntil : s.cooldownUntil) - now,
        queued: s.queue.length,
        inFlight: s.inFlight,
        recentBlocks: s.blockTimes.filter((t) => now - t < LIMITS.breakerWindowMs).length,
      });
    }
    return out;
  }

  /** Clears a domain's cooldown, circuit breaker and block history. */
  resetHost(host: string): boolean {
    const state = this.hosts.get(hostKey(host));
    if (!state) return false;
    state.cooldownUntil = 0;
    state.breakerUntil = 0;
    state.blockTimes = [];
    state.consecutiveBlocks = 0;
    this.pump(state);
    return true;
  }

  private stateFor(key: string): HostState {
    let state = this.hosts.get(key);
    if (!state) {
      state = {
        key, inFlight: 0, queue: [], nextDispatchAt: 0,
        cooldownUntil: 0, breakerUntil: 0, blockTimes: [], consecutiveBlocks: 0,
      };
      this.hosts.set(key, state);
    }
    return state;
  }

  private deadlineFor(scan: Scan): number {
    return scan.firstDispatchAt === undefined
      ? scan.startedAt + LIMITS.queueWaitMs
      : scan.firstDispatchAt + LIMITS.scanDeadlineMs;
  }

  private enqueue(state: HostState, entry: Pending): void {
    const at = state.queue.findIndex((q) => q.scan.id > entry.scan.id);
    if (at === -1) state.queue.push(entry);
    else state.queue.splice(at, 0, entry);
    this.armDeadline(state, entry);
  }

  private armDeadline(state: HostState, entry: Pending): void {
    const wait = Math.max(this.deadlineFor(entry.scan) - this.clock.now(), 0);
    entry.timer = this.clock.setTimeout(() => {
      if (this.deadlineFor(entry.scan) > this.clock.now()) {
        this.armDeadline(state, entry);
        return;
      }
      this.abort(state, entry.scan, `deadline passed waiting for ${state.key}`);
    }, wait);
  }

  // Marks the scan aborted, rejects its queued probes on this domain, and returns the
  // error for the caller to reject with.
  private abort(state: HostState, scan: Scan, reason: string): ScanAbortedError {
    if (!scan.abortReason) {
      scan.abortReason = reason;
      scan.log(`[Reflector++] Scan ${scan.id} aborted: ${reason}`);
    }
    const err = new ScanAbortedError(scan.abortReason);
    const kept: Pending[] = [];
    for (const q of state.queue) {
      if (q.scan === scan) this.settle(q, () => q.reject(err));
      else kept.push(q);
    }
    state.queue = kept;
    return err;
  }

  private settle(entry: Pending, finish: () => void): void {
    if (entry.timer !== undefined) this.clock.clearTimeout(entry.timer);
    entry.timer = undefined;
    finish();
  }

  private pump(state: HostState): void {
    if (state.wakeTimer !== undefined) this.clock.clearTimeout(state.wakeTimer);
    state.wakeTimer = undefined;
    const { concurrency, rps } = this.limits();
    while (state.queue.length > 0 && state.inFlight < Math.max(concurrency, 1)) {
      const now = this.clock.now();
      const readyAt = Math.max(state.cooldownUntil, rps > 0 ? state.nextDispatchAt : 0);
      if (readyAt > now) {
        state.wakeTimer = this.clock.setTimeout(() => this.pump(state), readyAt - now);
        return;
      }
      const entry = state.queue.shift() as Pending;
      if (this.deadlineFor(entry.scan) <= now) {
        state.queue.unshift(entry);
        this.abort(state, entry.scan, `deadline passed waiting for ${state.key}`);
        continue;
      }
      this.dispatch(state, entry, now, rps);
    }
    this.pruneIfIdle(state);
  }

  private dispatch(state: HostState, entry: Pending, now: number, rps: number): void {
    if (entry.timer !== undefined) this.clock.clearTimeout(entry.timer);
    entry.timer = undefined;
    state.inFlight++;
    if (entry.scan.firstDispatchAt === undefined) entry.scan.firstDispatchAt = now;
    if (rps > 0) state.nextDispatchAt = now + 1000 / rps;
    entry.rawSend(entry.spec, { timeouts: SEND_TIMEOUTS }).then(
      (result) => this.onResult(state, entry, result),
      (error) => {
        state.inFlight--;
        entry.reject(error);
        this.pump(state);
      },
    );
  }

  private onResult(state: HostState, entry: Pending, result: any): void {
    state.inFlight--;
    const block = blockSignal(result, this.clock.now());
    if (block) {
      this.recordBlock(state, block, entry.scan.log);
      entry.reject(this.abort(state, entry.scan, `${state.key} answered HTTP ${block.code}`));
    } else {
      state.consecutiveBlocks = 0;
      entry.resolve(result);
    }
    this.pump(state);
  }

  private recordBlock(state: HostState, block: BlockSignal, log: Log): void {
    const now = this.clock.now();
    state.blockTimes = state.blockTimes.filter((t) => now - t < LIMITS.breakerWindowMs);
    state.blockTimes.push(now);
    state.consecutiveBlocks++;
    if (state.blockTimes.length >= LIMITS.breakerThreshold) {
      state.breakerUntil = now + LIMITS.breakerMs;
      log(`[Reflector++] Circuit breaker open for ${state.key}: ${state.blockTimes.length} block `
        + `signals in ${LIMITS.breakerWindowMs / 1000}s; pausing probes for `
        + `${LIMITS.breakerMs / 60_000} min`);
      for (const q of [...state.queue]) {
        this.abort(state, q.scan, `circuit breaker open for ${state.key}`);
      }
      return;
    }
    const backoff = LIMITS.backoffMs[Math.min(state.consecutiveBlocks, LIMITS.backoffMs.length) - 1];
    const wait = block.retryAfterMs ?? (backoff as number);
    state.cooldownUntil = Math.max(state.cooldownUntil, now + wait);
    log(`[Reflector++] ${state.key} answered HTTP ${block.code}; cooling down for `
      + `${Math.round(wait / 1000)}s`);
  }

  // Drops the state of a domain with nothing pending, throttled or remembered, so the
  // map does not grow with every host ever probed.
  private pruneIfIdle(state: HostState): void {
    const now = this.clock.now();
    const idle = state.queue.length === 0 && state.inFlight === 0
      && state.cooldownUntil <= now && state.breakerUntil <= now
      && state.nextDispatchAt <= now
      && state.blockTimes.every((t) => now - t >= LIMITS.breakerWindowMs);
    if (idle) this.hosts.delete(state.key);
  }
}

export const probeLimiter = new ProbeLimiter();

/** The SDK surface a scan's analysis code uses: logging, and probes via the limiter. */
export interface ScanSdk {
  console: { log: Log };
  requests: { send: (spec: any) => Promise<any> };
  scan: Scan;
}

/**
 * Builds the SDK handed to a scan's analysis code. Its `requests.send` routes through
 * `limiter`, so no analysis code can send a probe that bypasses the per-domain limits.
 */
export function scanSdk(sdk: any, scan: Scan, limiter: ProbeLimiter = probeLimiter): ScanSdk {
  const rawSend: RawSend = (spec, options) => sdk.requests.send(spec, options);
  return {
    console: sdk.console,
    requests: { send: (spec) => limiter.send(rawSend, spec, scan) },
    scan,
  };
}
