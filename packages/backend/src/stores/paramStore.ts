import { TrackedParam } from './trackedParam.js';
import { BaseTrackedParamStore } from './baseTrackedParamStore.js';

const reqParamsStore = class _reqParamsStore extends BaseTrackedParamStore {
    private static _store: _reqParamsStore | undefined;

    private constructor() { super(); }

    static get(): _reqParamsStore {
        if (!this._store) this._store = new _reqParamsStore();
        return this._store;
    }

    paramTested(endpoint: string, candidate: TrackedParam): boolean {
        return this.has(endpoint, candidate);
    }

    addParam(endpoint: string, reqParam: TrackedParam): void {
        this.add(endpoint, reqParam);
    }
};

export { reqParamsStore };
