import { TrackedParam } from './trackedParam.js';
import { TESTED_VALUE_WINDOW, UNCONFIRMED_VALUE_CAP } from '../core/constants.js';

/**
 * Tracks which request params have been probed, so repeat requests are not re-probed.
 *
 * Identity is (endpoint, key, source, method, status code). Within it:
 * - Values are deduped individually (the most recent TESTED_VALUE_WINDOW per param), so a
 *   new value is tested even after a benign one -- e.g. `money` does not reflect but
 *   `money'` reflects inside a SQL error page.
 * - A confirmed param is deduped by name: a finding already exists for it.
 * - A param that reflected without confirming for UNCONFIRMED_VALUE_CAP distinct values in
 *   the same set of contexts is capped: new values landing in those contexts are not
 *   probed (rotating tokens, nonces). A value reflecting in a new context still is.
 */
export class TestedParamStore {
  private values = new Map<string, Set<string>>();
  private confirmed = new Set<string>();
  // nameKey -> context-set key -> values that reflected there without confirming
  private unconfirmed = new Map<string, Map<string, Set<string>>>();

  private nameKey(endpoint: string, p: TrackedParam): string {
    return [endpoint, p.key, p.source, p.method, p.code].join('\u0000');
  }

  private static contextKey(contexts: string[]): string {
    return [...new Set(contexts)].sort().join('|');
  }

  paramTested(endpoint: string, candidate: TrackedParam): boolean {
    const name = this.nameKey(endpoint, candidate);
    if (this.confirmed.has(name)) return true;
    return this.values.get(name)?.has(candidate.value ?? '') ?? false;
  }

  addParam(endpoint: string, param: TrackedParam): void {
    const name = this.nameKey(endpoint, param);
    let seen = this.values.get(name);
    if (!seen) {
      seen = new Set();
      this.values.set(name, seen);
    }
    seen.add(param.value ?? '');
    if (seen.size > TESTED_VALUE_WINDOW) {
      const oldest = seen.values().next().value as string;
      seen.delete(oldest);
    }
  }

  markConfirmed(endpoint: string, param: TrackedParam): void {
    this.confirmed.add(this.nameKey(endpoint, param));
  }

  /** True when the param is confirmed, or capped for this exact set of contexts. */
  capped(endpoint: string, param: TrackedParam, contexts: string[]): boolean {
    const name = this.nameKey(endpoint, param);
    if (this.confirmed.has(name)) return true;
    const values = this.unconfirmed.get(name)?.get(TestedParamStore.contextKey(contexts));
    return (values?.size ?? 0) >= UNCONFIRMED_VALUE_CAP;
  }

  /**
   * Records a value whose probes completed without confirming a reflection.
   *
   * Returns:
   *   true when this value is the one that reaches the cap, so the caller can log it once.
   */
  recordUnconfirmed(endpoint: string, param: TrackedParam, contexts: string[]): boolean {
    const name = this.nameKey(endpoint, param);
    let byContext = this.unconfirmed.get(name);
    if (!byContext) {
      byContext = new Map();
      this.unconfirmed.set(name, byContext);
    }
    const ctx = TestedParamStore.contextKey(contexts);
    let values = byContext.get(ctx);
    if (!values) {
      values = new Set();
      byContext.set(ctx, values);
    }
    if (values.size >= UNCONFIRMED_VALUE_CAP || values.has(param.value ?? '')) return false;
    values.add(param.value ?? '');
    return values.size === UNCONFIRMED_VALUE_CAP;
  }

  /**
   * Forgets params a scan enumerated but did not finish testing (it was aborted), so the
   * next request carrying them is probed again instead of being deduped.
   */
  release(endpoint: string, params: TrackedParam[]): void {
    for (const p of params) {
      const name = this.nameKey(endpoint, p);
      const value = p.value ?? '';
      const seen = this.values.get(name);
      seen?.delete(value);
      if (seen?.size === 0) this.values.delete(name);
      this.confirmed.delete(name);
      for (const values of this.unconfirmed.get(name)?.values() ?? []) values.delete(value);
    }
  }
}

type StoreHolder = { _store: TestedParamStore | undefined; get(): TestedParamStore };

const holder = (): StoreHolder => ({
  _store: undefined,
  get() {
    if (!this._store) this._store = new TestedParamStore();
    return this._store;
  },
});

/** Params probed by the body reflection check. */
export const reqParamsStore = holder();

/** Params probed by the response-header reflection check (tracked separately). */
export const headerParamsStore = holder();
