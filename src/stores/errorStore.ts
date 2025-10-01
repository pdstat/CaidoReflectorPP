import { TrackedParam } from './trackedParam.js';
import { BaseTrackedParamStore } from './baseTrackedParamStore.js';

const errorParamsStore = class _errorParamsStore extends BaseTrackedParamStore {
  private static _store: _errorParamsStore | undefined;

  private constructor() { super(); }

  static get(): _errorParamsStore {
    if (!this._store) this._store = new _errorParamsStore();
    return this._store;
  }

  paramErrored(endpoint: string, candidate: TrackedParam): boolean {
    return this.has(endpoint, candidate);
  }

  addParam(endpoint: string, reqParam: TrackedParam): void {
    this.add(endpoint, reqParam);
  }
};

export { errorParamsStore };
