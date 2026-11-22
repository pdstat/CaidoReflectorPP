import { TrackedParam } from './trackedParam.js';
import { BaseTrackedParamStore } from './baseTrackedParamStore.js';

const errorParamsStore = class _errorParamsStore extends BaseTrackedParamStore {
  private static _store: _errorParamsStore | undefined;

  private constructor() { super(); }

  static get(): _errorParamsStore {
    if (!this._store) this._store = new _errorParamsStore();
    return this._store;
  }

  // Value-insensitive: once a param errors during probing, skip it regardless
  // of value, so a flaky or probe-rejecting endpoint is not retried on every
  // new value.
  paramErrored(endpoint: string, candidate: TrackedParam): boolean {
    return this.has(endpoint, candidate, false);
  }

  addParam(endpoint: string, reqParam: TrackedParam): void {
    this.add(endpoint, reqParam, false);
  }
};

export { errorParamsStore };
