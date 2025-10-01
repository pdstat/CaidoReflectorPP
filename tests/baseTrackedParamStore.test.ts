import { BaseTrackedParamStore } from "../src/stores/baseTrackedParamStore.js";
import { TrackedParam } from "../src/stores/trackedParam.js";

// Test-visible subclass exposing protected internals through thin wrappers
class TestStore extends BaseTrackedParamStore {
  constructor() { super(); }
  addParam(endpoint: string, p: TrackedParam) { (this as any).add(endpoint, p); }
  hasParam(endpoint: string, p: TrackedParam) { return (this as any).has(endpoint, p); }
  count(endpoint: string) { return ((this as any).reqParams.get(endpoint) || []).length; }
}

const makeParam = (over: Partial<TrackedParam> = {}): TrackedParam => ({
  key: over.key ?? 'p',
  value: over.value,
  source: over.source ?? 'URL',
  method: over.method ?? 'GET',
  code: over.code ?? 200
});

describe('BaseTrackedParamStore', () => {
  test('adds first param and prevents duplicate with same identity fields', () => {
    const store = new TestStore();
    const ep = 'http://example.com/a';
    const param = makeParam({ key: 'x' });
    expect(store.hasParam(ep, param)).toBe(false);
    store.addParam(ep, param);
    expect(store.hasParam(ep, param)).toBe(true);
    expect(store.count(ep)).toBe(1);
    // duplicate add ignored
    store.addParam(ep, { ...param, value: 'DIFFERENTVALUE' });
    expect(store.count(ep)).toBe(1); // value not part of identity
  });

  test('different code considered distinct', () => {
    const store = new TestStore();
    const ep = 'http://example.com/b';
    store.addParam(ep, makeParam({ key: 'k', code: 200 }));
    store.addParam(ep, makeParam({ key: 'k', code: 404 }));
    expect(store.count(ep)).toBe(2);
  });

  test('different method considered distinct', () => {
    const store = new TestStore();
    const ep = 'http://example.com/c';
    store.addParam(ep, makeParam({ key: 'm', method: 'GET' }));
    store.addParam(ep, makeParam({ key: 'm', method: 'POST' }));
    expect(store.count(ep)).toBe(2);
  });

  test('different source considered distinct', () => {
    const store = new TestStore();
    const ep = 'http://example.com/d';
    store.addParam(ep, makeParam({ key: 's', source: 'URL' }));
    store.addParam(ep, makeParam({ key: 's', source: 'Cookie' }));
    store.addParam(ep, makeParam({ key: 's', source: 'Body' }));
    expect(store.count(ep)).toBe(3);
  });

  test('multiple mixed distinct variations accumulate correctly', () => {
    const store = new TestStore();
    const ep = 'http://example.com/e';
    store.addParam(ep, makeParam({ key: 'combo', code: 200, method: 'GET', source: 'URL' }));
    store.addParam(ep, makeParam({ key: 'combo', code: 201, method: 'GET', source: 'URL' }));
    store.addParam(ep, makeParam({ key: 'combo', code: 201, method: 'POST', source: 'URL' }));
    store.addParam(ep, makeParam({ key: 'combo', code: 201, method: 'POST', source: 'Cookie' }));
    // duplicate of first (different value) ignored
    store.addParam(ep, makeParam({ key: 'combo', code: 200, method: 'GET', source: 'URL', value: 'alt' }));
    expect(store.count(ep)).toBe(4);
  });
});
