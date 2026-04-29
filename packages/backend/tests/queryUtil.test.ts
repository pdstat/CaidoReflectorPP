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

    test('updates BodyJson value within JSON in form body', () => {
      const json = JSON.stringify({ items: [{ id: "orig", name: "test" }] });
      const body = `other=keep&data=${encodeURIComponent(json)}`;
      const spec = {
        _body: body,
        getBody() { return { toText: () => this._body }; },
        setBody(v: string) { this._body = v; },
        getHeader: (_: string) => undefined,
        getQuery: () => '',
        setQuery: (_: string) => {},
      } as any;
      const param: RequestParameter = {
        key: 'data.items[0].id', value: 'orig', source: 'BodyJson',
        method: 'POST', code: 200,
        parentKey: 'data', jsonPath: ['items', '0', 'id']
      };
      mutateParamValue(spec, param, 'INJECTED', sdk());
      const pairs = spec._body.split('&');
      expect(pairs[0]).toBe('other=keep');
      const dataVal = decodeURIComponent(pairs[1].split('=')[1]);
      const parsed = JSON.parse(dataVal);
      expect(parsed.items[0].id).toBe('INJECTED');
      expect(parsed.items[0].name).toBe('test');
    });

    test('BodyJson mutation preserves other form params exactly', () => {
      const json = JSON.stringify({ val: "original" });
      const body = `token=abc%3D%3D&data=${encodeURIComponent(json)}&extra=x%26y`;
      const spec = {
        _body: body,
        getBody() { return { toText: () => this._body }; },
        setBody(v: string) { this._body = v; },
        getHeader: (_: string) => undefined,
        getQuery: () => '',
        setQuery: (_: string) => {},
      } as any;
      const param: RequestParameter = {
        key: 'data.val', value: 'original', source: 'BodyJson',
        method: 'POST', code: 200,
        parentKey: 'data', jsonPath: ['val']
      };
      mutateParamValue(spec, param, 'NEW', sdk());
      const parts = spec._body.split('&');
      expect(parts[0]).toBe('token=abc%3D%3D');
      expect(parts[2]).toBe('extra=x%26y');
    });

    test('updates UrlJson value within JSON in query string', () => {
      const json = JSON.stringify({ user: { name: "orig" } });
      const query = `other=keep&config=${encodeURIComponent(json)}`;
      const spec = {
        _query: query,
        getQuery() { return this._query; },
        setQuery(q: string) { this._query = q; },
        getBody: () => undefined,
        setBody: (_: string) => {},
        getHeader: (_: string) => undefined,
      } as any;
      const param: RequestParameter = {
        key: 'config.user.name', value: 'orig', source: 'UrlJson',
        method: 'GET', code: 200,
        parentKey: 'config', jsonPath: ['user', 'name']
      };
      mutateParamValue(spec, param, 'INJECTED', sdk());
      const pairs = spec._query.split('&');
      expect(pairs[0]).toBe('other=keep');
      const configVal = decodeURIComponent(pairs[1].split('=')[1]);
      const parsed = JSON.parse(configVal);
      expect(parsed.user.name).toBe('INJECTED');
    });

    test('updates Cookie value when present', () => {
      const spec = {
        _cookie: 'sid=abc123; theme=light',
        getHeader: (name: string) => name === 'Cookie' ? [spec._cookie] : undefined,
        setHeader: (name: string, v: string) => { if (name === 'Cookie') spec._cookie = v; },
        getQuery: () => '',
        setQuery: (_: string) => {},
        getBody: () => undefined,
        setBody: (_: string) => {}
      } as any;
      const param: RequestParameter = { key: 'sid', value: 'abc123', source: 'Cookie', method: 'GET', code: 200 };
      mutateParamValue(spec, param, 'NEWSESSION', sdk());
      expect(spec._cookie).toBe('sid=NEWSESSION; theme=light');
    });

    test('updates request header value', () => {
      const spec = {
        _headers: { 'User-Agent': 'OriginalUA' } as Record<string, string>,
        setHeader(name: string, v: string) { this._headers[name] = v; },
        getHeader: (_: string) => undefined,
        getQuery: () => '',
        setQuery: (_: string) => {},
        getBody: () => undefined,
        setBody: (_: string) => {}
      } as any;
      const param: RequestParameter = { key: 'header:User-Agent', value: 'OriginalUA', source: 'Header', method: 'GET', code: 200 };
      mutateParamValue(spec, param, 'ProbeValue123', sdk());
      expect(spec._headers['User-Agent']).toBe('ProbeValue123');
    });

    test('updates URL path segment by index', () => {
      const spec = {
        _path: '/gym.php/originalvalue/detail',
        getPath() { return this._path; },
        setPath(p: string) { this._path = p; },
        getHeader: (_: string) => undefined,
        getQuery: () => '',
        setQuery: (_: string) => {},
        getBody: () => undefined,
        setBody: (_: string) => {}
      } as any;
      const param: RequestParameter = { key: 'path:1:originalvalue', value: 'originalvalue', source: 'Path', method: 'GET', code: 200 };
      mutateParamValue(spec, param, 'INJECTED', sdk());
      expect(spec._path).toBe('/gym.php/INJECTED/detail');
    });

    test('path mutation encodes special characters', () => {
      const spec = {
        _path: '/page/target',
        getPath() { return this._path; },
        setPath(p: string) { this._path = p; },
        getHeader: (_: string) => undefined,
        getQuery: () => '',
        setQuery: (_: string) => {},
        getBody: () => undefined,
        setBody: (_: string) => {}
      } as any;
      const param: RequestParameter = { key: 'path:1:target', value: 'target', source: 'Path', method: 'GET', code: 200 };
      mutateParamValue(spec, param, 'a/b c', sdk());
      expect(spec._path).toBe('/page/a%2Fb%20c');
    });
  });
});
