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

  test('value-sensitive: a different value is a distinct test (not deduped)', () => {
    const store = reqParamsStore.get();
    const ep = 'http://ex/vs';
    store.addParam(ep, makeParam({ key: 'dup', value: 'one' }));
    // a new value must be re-testable (e.g. 'money' then "money'")
    expect(store.paramTested(ep, makeParam({ key: 'dup', value: 'two' }))).toBe(false);
    store.addParam(ep, makeParam({ key: 'dup', value: 'two' }));
    const internal = (store as any).reqParams.get(ep) as TrackedParam[];
    expect(internal.length).toBe(2);
    // same value is deduped
    expect(store.paramTested(ep, makeParam({ key: 'dup', value: 'one' }))).toBe(true);
  });

  test('markConfirmed: after a confirmed finding, later values dedupe by name', () => {
    const store = reqParamsStore.get();
    const ep = 'http://ex/confirmed';
    const benign = makeParam({ key: 'qs', value: 'money' });
    const payload = makeParam({ key: 'qs', value: "money'" });
    // benign value seen, did not reflect -> payload value is still testable
    store.addParam(ep, benign);
    expect(store.paramTested(ep, payload)).toBe(false);
    // payload reflected + confirmed -> mark it
    store.addParam(ep, payload);
    store.markConfirmed(ep, payload);
    // now ANY further value of qs is deduped by name
    expect(store.paramTested(ep, makeParam({ key: 'qs', value: '<script>' }))).toBe(true);
    expect(store.paramTested(ep, makeParam({ key: 'qs', value: 'brandnew' }))).toBe(true);
    // a different param on the same endpoint is unaffected
    expect(store.paramTested(ep, makeParam({ key: 'other', value: 'x' }))).toBe(false);
  });

  test('release: forgets the released values and confirmations only', () => {
    const store = reqParamsStore.get();
    const ep = 'http://ex/release';
    const a = makeParam({ key: 'a', value: '1' });
    const b = makeParam({ key: 'b', value: '2' });
    store.addParam(ep, a);
    store.addParam(ep, b);
    store.markConfirmed(ep, a);
    store.release(ep, [a]);
    expect(store.paramTested(ep, a)).toBe(false);
    expect(store.paramTested(ep, makeParam({ key: 'a', value: 'other' }))).toBe(false);
    expect(store.paramTested(ep, b)).toBe(true);
    store.release(ep, [b]);
    expect((store as any).reqParams.has(ep)).toBe(false);
    expect(() => store.release('http://ex/unknown', [a])).not.toThrow();
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
