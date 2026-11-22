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
    // Server/environment-controlled sources carry a value that varies per
    // request (session cookies, User-Agent/Referer, path segments), so the
    // value is part of the identity: a new value is a new reflection to test.
    // Query/body values are the tester's own payload, deduped by name alone.
    const valueSensitive =
      candidate.source === 'Cookie' ||
      candidate.source === 'Header' ||
      candidate.source === 'Path';
    return params.some(
      (param) =>
        param.key === candidate.key &&
        param.source === candidate.source &&
        param.method === candidate.method &&
        param.code === candidate.code &&
        (!valueSensitive || param.value === candidate.value)
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
