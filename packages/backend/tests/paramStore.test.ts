import { reqParamsStore, headerParamsStore } from "../src/stores/paramStore.js";
import { TrackedParam } from "../src/stores/trackedParam.js";
import { TESTED_VALUE_WINDOW, UNCONFIRMED_VALUE_CAP } from "../src/core/constants.js";

const makeParam = (over: Partial<TrackedParam> = {}): TrackedParam => ({
  key: over.key ?? 'k',
  value: over.value,
  source: over.source ?? 'URL',
  method: over.method ?? 'GET',
  code: over.code ?? 200,
});

const EP = 'http://ex/page';

describe('reqParamsStore', () => {
  beforeEach(() => {
    (reqParamsStore as any)._store = undefined;
    (headerParamsStore as any)._store = undefined;
  });

  test('get() returns same singleton instance', () => {
    expect(reqParamsStore.get()).toBe(reqParamsStore.get());
  });

  test('paramTested false before add then true after', () => {
    const store = reqParamsStore.get();
    const p = makeParam({ key: 't1', value: 'v' });
    expect(store.paramTested(EP, p)).toBe(false);
    store.addParam(EP, p);
    expect(store.paramTested(EP, p)).toBe(true);
  });

  test('value-sensitive: a different value is a distinct test (money, then money\')', () => {
    const store = reqParamsStore.get();
    store.addParam(EP, makeParam({ key: 'q', value: 'money' }));
    expect(store.paramTested(EP, makeParam({ key: 'q', value: "money'" }))).toBe(false);
    expect(store.paramTested(EP, makeParam({ key: 'q', value: 'money' }))).toBe(true);
  });

  test('markConfirmed: after a confirmed finding, later values dedupe by name', () => {
    const store = reqParamsStore.get();
    const payload = makeParam({ key: 'qs', value: "money'" });
    store.addParam(EP, payload);
    store.markConfirmed(EP, payload);
    expect(store.paramTested(EP, makeParam({ key: 'qs', value: 'brandnew' }))).toBe(true);
    expect(store.paramTested(EP, makeParam({ key: 'other', value: 'x' }))).toBe(false);
  });

  test.each([
    ['code', { code: 500 }],
    ['method', { method: 'POST' }],
    ['source', { source: 'Cookie' }],
    ['endpoint', {}],
  ])('a different %s is a separate identity', (field, over) => {
    const store = reqParamsStore.get();
    const base = makeParam({ key: 'c', value: 'v' });
    store.addParam(EP, base);
    store.markConfirmed(EP, base);
    const ep = field === 'endpoint' ? 'http://ex/other' : EP;
    expect(store.paramTested(ep, makeParam({ key: 'c', value: 'v', ...over }))).toBe(false);
  });

  test(`keeps only the ${TESTED_VALUE_WINDOW} most recent values per param`, () => {
    const store = reqParamsStore.get();
    for (let i = 0; i <= TESTED_VALUE_WINDOW; i++) store.addParam(EP, makeParam({ value: `v${i}` }));
    expect(store.paramTested(EP, makeParam({ value: 'v0' }))).toBe(false);
    expect(store.paramTested(EP, makeParam({ value: 'v1' }))).toBe(true);
    expect(store.paramTested(EP, makeParam({ value: `v${TESTED_VALUE_WINDOW}` }))).toBe(true);
  });

  test('release: forgets the released values and confirmations only', () => {
    const store = reqParamsStore.get();
    const a = makeParam({ key: 'a', value: '1' });
    const b = makeParam({ key: 'b', value: '2' });
    store.addParam(EP, a);
    store.addParam(EP, b);
    store.markConfirmed(EP, a);
    store.release(EP, [a]);
    expect(store.paramTested(EP, a)).toBe(false);
    expect(store.paramTested(EP, makeParam({ key: 'a', value: 'other' }))).toBe(false);
    expect(store.paramTested(EP, b)).toBe(true);
    expect(() => store.release('http://ex/unknown', [a])).not.toThrow();
  });
});

describe('unconfirmed-value cap', () => {
  beforeEach(() => { (reqParamsStore as any)._store = undefined; });

  const fill = (contexts: string[], n = UNCONFIRMED_VALUE_CAP): boolean[] => {
    const store = reqParamsStore.get();
    const tripped: boolean[] = [];
    for (let i = 0; i < n; i++) {
      tripped.push(store.recordUnconfirmed(EP, makeParam({ key: 'tok', value: `t${i}` }), contexts));
    }
    return tripped;
  };

  test(`caps after ${UNCONFIRMED_VALUE_CAP} distinct unconfirmed values, reporting the trip once`, () => {
    const store = reqParamsStore.get();
    const tripped = fill(['html-attr'], UNCONFIRMED_VALUE_CAP - 1);
    expect(tripped.every((t) => !t)).toBe(true);
    expect(store.capped(EP, makeParam({ key: 'tok', value: 'new' }), ['html-attr'])).toBe(false);
    expect(store.recordUnconfirmed(EP, makeParam({ key: 'tok', value: 'last' }), ['html-attr'])).toBe(true);
    expect(store.capped(EP, makeParam({ key: 'tok', value: 'new' }), ['html-attr'])).toBe(true);
    expect(store.recordUnconfirmed(EP, makeParam({ key: 'tok', value: 'more' }), ['html-attr'])).toBe(false);
  });

  test('the same value recorded twice counts once', () => {
    const store = reqParamsStore.get();
    for (let i = 0; i < UNCONFIRMED_VALUE_CAP + 2; i++) {
      store.recordUnconfirmed(EP, makeParam({ key: 'tok', value: 'same' }), ['html']);
    }
    expect(store.capped(EP, makeParam({ key: 'tok', value: 'x' }), ['html'])).toBe(false);
  });

  test('a value reflecting in a new set of contexts is still probed', () => {
    const store = reqParamsStore.get();
    fill(['html-attr']);
    expect(store.capped(EP, makeParam({ key: 'tok' }), ['html-attr', 'html'])).toBe(false);
    expect(store.capped(EP, makeParam({ key: 'tok' }), ['js'])).toBe(false);
  });

  test('context order and duplicates do not matter', () => {
    const store = reqParamsStore.get();
    fill(['b', 'a']);
    expect(store.capped(EP, makeParam({ key: 'tok' }), ['a', 'b', 'a'])).toBe(true);
  });

  test('a confirmed param counts as capped everywhere', () => {
    const store = reqParamsStore.get();
    store.markConfirmed(EP, makeParam({ key: 'tok' }));
    expect(store.capped(EP, makeParam({ key: 'tok' }), ['anything'])).toBe(true);
  });

  test('release un-counts the released values', () => {
    const store = reqParamsStore.get();
    fill(['html']);
    store.release(EP, [makeParam({ key: 'tok', value: 't0' })]);
    expect(store.capped(EP, makeParam({ key: 'tok' }), ['html'])).toBe(false);
  });

  test('body and header stores are independent', () => {
    fill(['html']);
    reqParamsStore.get().markConfirmed(EP, makeParam({ key: 'tok' }));
    expect(headerParamsStore.get().capped(EP, makeParam({ key: 'tok' }), ['html'])).toBe(false);
    expect(headerParamsStore.get().paramTested(EP, makeParam({ key: 'tok', value: 't0' }))).toBe(false);
  });
});
