import { TrackedParam } from './trackedParam.js';
import { BaseTrackedParamStore } from './baseTrackedParamStore.js';

const reqParamsStore = class _reqParamsStore extends BaseTrackedParamStore {
    private static _store: _reqParamsStore | undefined;

    private constructor() { super(); }

    static get(): _reqParamsStore {
        if (!this._store) this._store = new _reqParamsStore();
        return this._store;
    }

    // Params that have already produced a confirmed reflection, keyed by name
    // identity (no value). Once a reflection is confirmed at a param, further
    // values of it are not re-probed -- the finding already exists.
    private confirmed: Set<string> = new Set();

    private nameKey(endpoint: string, p: TrackedParam): string {
        return [endpoint, p.key, p.source, p.method, p.code].join('\u0000');
    }

    // Value-sensitive: a new value for a not-yet-confirmed param is a distinct
    // test, so an input that reflects only after a tweak (e.g. a quote that
    // triggers an error-gated echo) is not skipped because an earlier benign
    // value was seen. Once confirmed, the param is deduped by name.
    paramTested(endpoint: string, candidate: TrackedParam): boolean {
        if (this.confirmed.has(this.nameKey(endpoint, candidate))) return true;
        return this.has(endpoint, candidate, true);
    }

    addParam(endpoint: string, reqParam: TrackedParam): void {
        this.add(endpoint, reqParam, true);
    }

    markConfirmed(endpoint: string, param: TrackedParam): void {
        this.confirmed.add(this.nameKey(endpoint, param));
    }

    // Forgets params a scan enumerated but did not finish testing (it was aborted), so
    // the next request carrying them is probed again instead of being deduped.
    release(endpoint: string, params: TrackedParam[]): void {
        for (const p of params) {
            this.remove(endpoint, p, true);
            this.confirmed.delete(this.nameKey(endpoint, p));
        }
    }
};

export { reqParamsStore };
