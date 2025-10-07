import { reqParamsStore } from "../src/stores/paramStore.js";
import { TrackedParam } from "../src/stores/trackedParam.js";

const makeParam = (over: Partial<TrackedParam> = {}): TrackedParam => ({
  key: over.key ?? 'k',
  value: over.value,
  source: over.source ?? 'URL',
  method: over.method ?? 'GET',
  code: over.code ?? 200,
});

describe('reqParamsStore', () => {
  beforeEach(() => {
    // Reset singleton instance for isolation
    (reqParamsStore as any)._store = undefined;
  });

  test('get() returns same singleton instance', () => {
    const a = reqParamsStore.get();
    const b = reqParamsStore.get();
    expect(a).toBe(b);
  });

  test('paramTested false before add then true after', () => {
    const store = reqParamsStore.get();
    const ep = 'http://ex/tested';
    const p = makeParam({ key: 't1' });
    expect(store.paramTested(ep, p)).toBe(false);
    store.addParam(ep, p);
    expect(store.paramTested(ep, p)).toBe(true);
  });

  test('dedup ignores value differences', () => {
    const store = reqParamsStore.get();
    const ep = 'http://ex/dedup';
    store.addParam(ep, makeParam({ key: 'dup', value: 'one' }));
    store.addParam(ep, makeParam({ key: 'dup', value: 'two' }));
    const internal = (store as any).reqParams.get(ep) as TrackedParam[];
    expect(internal.length).toBe(1);
  });

  test('different code tracked separately', () => {
    const store = reqParamsStore.get();
    const ep = 'http://ex/code';
    store.addParam(ep, makeParam({ key: 'c', code: 200 }));
    store.addParam(ep, makeParam({ key: 'c', code: 500 }));
    const internal = (store as any).reqParams.get(ep) as TrackedParam[];
    expect(internal.length).toBe(2);
  });

  test('different method and source tracked separately', () => {
    const store = reqParamsStore.get();
    const ep = 'http://ex/method-source';
    store.addParam(ep, makeParam({ key: 'm', method: 'GET', source: 'URL' }));
    store.addParam(ep, makeParam({ key: 'm', method: 'POST', source: 'URL' }));
    store.addParam(ep, makeParam({ key: 'm', method: 'POST', source: 'Cookie' }));
    const internal = (store as any).reqParams.get(ep) as TrackedParam[];
    expect(internal.length).toBe(3);
  });
});
