import { TrackedParam } from './trackedParam.js';

// A small reusable singleton-style store builder to track TrackedParam arrays per endpoint.
// Each logical store (request tested vs error encountered) just supplies the semantic
// predicate name (tested/errored) via wrapping methods.
export class BaseTrackedParamStore {
  protected reqParams: Map<string, TrackedParam[]> = new Map();

  protected constructor() {}

  protected has(endpoint: string, candidate: TrackedParam): boolean {
    const params = this.reqParams.get(endpoint);
    if (!params) return false;
    return params.some(
      (param) =>
        param.key === candidate.key &&
        param.source === candidate.source &&
        param.method === candidate.method &&
        param.code === candidate.code
    );
  }

  protected add(endpoint: string, reqParam: TrackedParam): void {
    const params = this.reqParams.get(endpoint) || [];
    if (!this.has(endpoint, reqParam)) {
      params.push(reqParam);
      this.reqParams.set(endpoint, params);
    }
  }
}
