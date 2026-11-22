import { TrackedParam } from './trackedParam.js';

// A small reusable singleton-style store builder to track TrackedParam arrays per endpoint.
// Each logical store (request tested vs error encountered) just supplies the semantic
// predicate name (tested/errored) via wrapping methods.
export class BaseTrackedParamStore {
  protected reqParams: Map<string, TrackedParam[]> = new Map();

  protected constructor() {}

  // valueSensitive: when true, the value is part of the identity, so a new
  // value for the same (key, source, method, code) is a distinct entry. The
  // request store uses this so a param that did not reflect on one value is
  // still tested on the next; the error store uses false so a param that
  // already errored is not retried on every new value.
  protected has(
    endpoint: string,
    candidate: TrackedParam,
    valueSensitive: boolean
  ): boolean {
    const params = this.reqParams.get(endpoint);
    if (!params) return false;
    return params.some(
      (param) =>
        param.key === candidate.key &&
        param.source === candidate.source &&
        param.method === candidate.method &&
        param.code === candidate.code &&
        (!valueSensitive || param.value === candidate.value)
    );
  }

  protected add(
    endpoint: string,
    reqParam: TrackedParam,
    valueSensitive: boolean
  ): void {
    const params = this.reqParams.get(endpoint) || [];
    if (!this.has(endpoint, reqParam, valueSensitive)) {
      params.push(reqParam);
      this.reqParams.set(endpoint, params);
    }
  }
}
