import { queryToString, parseQueryString, mutateParamValue } from '../src/utils/query.js';
import type { RequestParameter } from '../src/core/types.js';

const sdk = () => ({ console: { log: jest.fn() } });

describe('query utilities', () => {
  describe('parseQueryString', () => {
    test('parses simple k=v pairs', () => {
      expect(parseQueryString('a=1&b=two')).toEqual({ a: '1', b: 'two' });
    });
    test('decodes URL-encoded names and values', () => {
      const q = 'na%20me=va%2Flue&x=%26';
      expect(parseQueryString(q)).toEqual({ 'na me': 'va/lue', x: '&' });
    });
    test('empty string returns empty object', () => {
      expect(parseQueryString('')).toEqual({});
    });
    test('handles parameter with empty value', () => {
      expect(parseQueryString('a=&b=2')).toEqual({ a: '', b: '2' });
    });
  });

  describe('queryToString', () => {
    test('serializes object to k=v pairs joined by &', () => {
      const obj = { b: '2', a: '1' } as Record<string,string>;
      // JS preserves insertion order for different keys as added; emulate addition order
      const reconstructed = queryToString(obj);
      // Order is implementation dependent on insertion; allow either
      expect(['b=2&a=1','a=1&b=2']).toContain(reconstructed);
    });
    test('round trip with parseQueryString (lossless for simple values)', () => {
      const original = 'k1=v1&k2=v%2Flash';
      const parsed = parseQueryString(original);
      const serialized = queryToString(parsed);
      // Because encode is not applied in queryToString, explicit %2F will become literal '/'
      expect(serialized).toBe('k1=v1&k2=v/lash');
    });
  });

  describe('mutateParamValue', () => {
    test('updates URL query parameter', () => {
      const spec = {
        _query: 'a=1&b=2',
        getQuery() { return this._query; },
        setQuery(q: string) { this._query = q; },
        getBody: () => undefined,
        setBody: (_: string) => {},
        getHeader: (_: string) => undefined,
      } as any;
      const param: RequestParameter = { key: 'b', value: '2', source: 'URL', method: 'GET', code: 200 };
      mutateParamValue(spec, param, 'zzz', sdk());
      expect(spec._query).toBe('a=1&b=zzz');
    });

    test('does nothing if URL parameter absent', () => {
      const spec = {
        _query: 'a=1&b=2',
        getQuery() { return this._query; },
        setQuery(q: string) { this._query = q; },
        getBody: () => undefined,
        setBody: (_: string) => {},
        getHeader: (_: string) => undefined,
      } as any;
      const param: RequestParameter = { key: 'c', value: undefined, source: 'URL', method: 'GET', code: 200 };
      mutateParamValue(spec, param, 'zzz', sdk());
      expect(spec._query).toBe('a=1&b=2');
    });

    test('updates JSON body nested path when present', () => {
      const spec = {
        _body: JSON.stringify({ user: { name: 'alice', age: 30 } }),
        getBody() { return { toText: () => this._body }; },
        setBody(v: string) { this._body = v; },
        getHeader(name: string) { return name === 'Content-Type' ? ['application/json'] : undefined; },
        getQuery: () => '',
        setQuery: (_: string) => {},
      } as any;
      const param: RequestParameter = { key: 'user.name', value: 'alice', source: 'Body', method: 'POST', code: 200 };
      mutateParamValue(spec, param, 'bob', sdk());
      expect(JSON.parse(spec._body)).toEqual({ user: { name: 'bob', age: 30 } });
    });

    test('JSON body unchanged if path missing', () => {
      const original = { user: { name: 'alice' } };
      const spec = {
        _body: JSON.stringify(original),
        getBody() { return { toText: () => this._body }; },
        setBody(v: string) { this._body = v; },
        getHeader(name: string) { return name === 'Content-Type' ? ['application/json'] : undefined; },
        getQuery: () => '',
        setQuery: (_: string) => {},
      } as any;
      const param: RequestParameter = { key: 'user.missing', value: undefined, source: 'Body', method: 'POST', code: 200 };
      mutateParamValue(spec, param, 'X', sdk());
      expect(JSON.parse(spec._body)).toEqual(original);
    });

    test('updates form-urlencoded body when non-JSON', () => {
      const spec = {
        _body: 'a=1&b=2',
        getBody() { return { toText: () => this._body }; },
        setBody(v: string) { this._body = v; },
        getHeader: (_: string) => undefined,
        getQuery: () => '',
        setQuery: (_: string) => {},
      } as any;
      const param: RequestParameter = { key: 'b', value: '2', source: 'Body', method: 'POST', code: 200 };
      mutateParamValue(spec, param, '999', sdk());
      expect(spec._body).toBe('a=1&b=999');
    });
  });
});
