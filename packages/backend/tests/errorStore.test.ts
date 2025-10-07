import { errorParamsStore } from "../src/stores/errorStore.js";
import { TrackedParam } from "../src/stores/trackedParam.js";

const makeParam = (over: Partial<TrackedParam> = {}): TrackedParam => ({
  key: over.key ?? 'k',
  value: over.value,
  source: over.source ?? 'URL',
  method: over.method ?? 'GET',
  code: over.code ?? 200
});

describe('errorParamsStore', () => {
  beforeEach(() => {
    // Reset singleton between tests to ensure isolation
    (errorParamsStore as any)._store = undefined;
  });

  test('get() returns singleton instance', () => {
    const a = errorParamsStore.get();
    const b = errorParamsStore.get();
    expect(a).toBe(b);
  });

  test('paramErrored false before add then true after', () => {
    const store = errorParamsStore.get();
    const ep = 'http://e/x';
    const p = makeParam({ key: 'err' });
    expect(store.paramErrored(ep, p)).toBe(false);
    store.addParam(ep, p);
    expect(store.paramErrored(ep, p)).toBe(true);
  });

  test('value differences do not affect identity (dedup)', () => {
    const store = errorParamsStore.get();
    const ep = 'http://e/y';
    const p1 = makeParam({ key: 'dup', value: 'one' });
    const p2 = makeParam({ key: 'dup', value: 'two' });
    store.addParam(ep, p1);
    store.addParam(ep, p2); // should not create second entry
    const internal = (store as any).reqParams.get(ep) as TrackedParam[];
    expect(internal.length).toBe(1);
    expect(store.paramErrored(ep, p2)).toBe(true);
  });

  test('different code creates distinct tracked entries', () => {
    const store = errorParamsStore.get();
    const ep = 'http://e/z';
    const p200 = makeParam({ key: 'c', code: 200 });
    const p404 = makeParam({ key: 'c', code: 404 });
    store.addParam(ep, p200);
    store.addParam(ep, p404);
    const internal = (store as any).reqParams.get(ep) as TrackedParam[];
    expect(internal.length).toBe(2);
    expect(store.paramErrored(ep, p200)).toBe(true);
    expect(store.paramErrored(ep, p404)).toBe(true);
  });

  test('different method and source create distinct entries', () => {
    const store = errorParamsStore.get();
    const ep = 'http://e/w';
    store.addParam(ep, makeParam({ key: 'm', method: 'GET', source: 'URL' }));
    store.addParam(ep, makeParam({ key: 'm', method: 'POST', source: 'URL' }));
    store.addParam(ep, makeParam({ key: 'm', method: 'POST', source: 'Cookie' }));
    const internal = (store as any).reqParams.get(ep) as TrackedParam[];
    expect(internal.length).toBe(3);
  });
});
