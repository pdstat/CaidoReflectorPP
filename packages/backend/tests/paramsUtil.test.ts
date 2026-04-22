import { enumerateRequestParameters } from "../src/utils/params.js";

// Helper to build a minimal spec-like object
const makeSpec = (opts: Partial<{
  query: string;
  method: string;
  cookies: string;
  body: string;
  contentType: string;
  https: boolean;
  headers: Record<string, string[]>;
  path: string;
}> = {}) => ({
  getQuery: () => opts.query,
  getMethod: () => opts.method || (opts.body ? 'POST' : 'GET'),
  getHeader: (name: string) => {
    if (name === 'Cookie' && opts.cookies) return [opts.cookies];
    if (name === 'Content-Type' && opts.contentType) return [opts.contentType];
    if (opts.headers) return opts.headers[name];
    return undefined;
  },
  getHeaders: () => {
    const h: Record<string, string[]> = {};
    if (opts.cookies) h['Cookie'] = [opts.cookies];
    if (opts.contentType) h['Content-Type'] = [opts.contentType];
    if (opts.headers) Object.assign(h, opts.headers);
    return h;
  },
  getBody: () => (opts.body ? { toText: () => opts.body } : undefined),
  getTls: () => !!opts.https,
  getHost: () => 'example.com',
  getPath: () => opts.path ?? '/a'
});

// Minimal SDK mock capturing console logs
const makeSdk = () => ({ console: { log: jest.fn() } });

// Utility: create new endpoint variation to avoid store collision when desired
let endpointCounter = 0;
const uniqueSpec = (base: Parameters<typeof makeSpec>[0] = {}) => {
  endpointCounter++;
  return {
    ...makeSpec(base),
    getPath: () => '/a' + endpointCounter
  };
};

describe('enumerateRequestParameters', () => {
  test('enumerates query parameters', () => {
    const sdk = makeSdk();
    const spec = makeSpec({ query: 'x=1&y=two' });
    const out = enumerateRequestParameters(spec, sdk, 200, true);
    expect(out.map(p => p.key)).toEqual(['x','y']);
    expect(out.every(p => p.source === 'URL')).toBe(true);
  });

  test('enumerates cookies', () => {
    const sdk = makeSdk();
    const spec = makeSpec({ cookies: 'sid=abc; theme=dark; bad' }); // 'bad' ignored (no '=')
    const out = enumerateRequestParameters(spec, sdk, 200, true);
    expect(out.find(p => p.key === 'sid')?.value).toBe('abc');
    expect(out.find(p => p.key === 'theme')?.value).toBe('dark');
    expect(out.some(p => p.key === 'bad')).toBe(false);
    expect(out.every(p => p.source === 'Cookie')).toBe(true);
  });

  test('enumerates form body parameters (POST + x-www-form-urlencoded)', () => {
    const sdk = makeSdk();
    const spec = makeSpec({ body: 'a=1&b=2', contentType: 'application/x-www-form-urlencoded' });
    const out = enumerateRequestParameters(spec, sdk, 201, true);
    expect(out.map(p => p.key).sort()).toEqual(['a','b']);
    expect(out.every(p => p.source === 'Body')).toBe(true);
    // Response code captured
    expect(out[0].code).toBe(201);
  });

  test('does not enumerate body when method not POST', () => {
    const sdk = makeSdk();
    const spec: any = makeSpec({ body: 'a=1', contentType: 'application/x-www-form-urlencoded' });
    // Force method override to GET
    spec.getMethod = () => 'GET';
    const out = enumerateRequestParameters(spec, sdk, 200, true);
    expect(out.length).toBe(0);
  });

  test('tracking prevents duplicate enumeration for same endpoint / key / source / method / code', () => {
    const sdk = makeSdk();
    const spec = makeSpec({ query: 'dup=1' });
    const first = enumerateRequestParameters(spec, sdk, 200, true);
    const second = enumerateRequestParameters(spec, sdk, 200, true);
    expect(first.length).toBe(1);
    expect(second.length).toBe(0); // already tracked
  });

  test('track=false returns parameters each time (no store mutation)', () => {
    const sdk = makeSdk();
    const spec = uniqueSpec({ query: 'z=9' });
    const a = enumerateRequestParameters(spec, sdk, 200, false);
    const b = enumerateRequestParameters(spec, sdk, 200, false);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });

  test('empty spec yields log and empty array', () => {
    const sdk = makeSdk();
    const spec: any = { getQuery: () => '', getMethod: () => 'GET', getHeader: () => undefined, getBody: () => undefined, getTls: () => false, getHost: () => 'example.com', getPath: () => '/a' };
    const out = enumerateRequestParameters(spec, sdk, 200, true);
    expect(out).toHaveLength(0);
    expect(sdk.console.log).toHaveBeenCalledWith('[Reflector++] No (new) parameters found');
  });

  test('ignores query pair without =', () => {
    const sdk = makeSdk();
    const spec = makeSpec({ query: 'a=1&flag&b=2' });
    const out = enumerateRequestParameters(spec, sdk, 200, true);
    expect(out.map(p => p.key).sort()).toEqual(['a','b']);
  });

  test('cookie parsing trims key whitespace', () => {
    const sdk = makeSdk();
    const spec = makeSpec({ cookies: '  token =abc ; x=1' });
    const out = enumerateRequestParameters(spec, sdk, 200, true);
    expect(out.find(p => p.key === 'token')?.value).toBe('abc');
  });

  test('enumerates request header values as Header source', () => {
    const sdk = makeSdk();
    const spec = uniqueSpec({
      headers: {
        'User-Agent': ['Mozilla/5.0 TestBrowser'],
        'Referer': ['https://example.com/page'],
        'X-Custom-Debug': ['my-debug-value-12345']
      }
    });
    const out = enumerateRequestParameters(spec, sdk, 200, false);
    const headerParams = out.filter(p => p.source === 'Header');
    expect(headerParams.length).toBe(3);
    expect(headerParams.find(p => p.key === 'header:User-Agent')?.value).toBe('Mozilla/5.0 TestBrowser');
    expect(headerParams.find(p => p.key === 'header:Referer')?.value).toBe('https://example.com/page');
    expect(headerParams.find(p => p.key === 'header:X-Custom-Debug')?.value).toBe('my-debug-value-12345');
  });

  test('skips short header values and skip-listed headers', () => {
    const sdk = makeSdk();
    const spec = uniqueSpec({
      headers: {
        'Host': ['example.com'],
        'Authorization': ['Bearer secret'],
        'X-Short': ['abc'],
        'X-Good': ['long-enough-value']
      }
    });
    const out = enumerateRequestParameters(spec, sdk, 200, false);
    const headerParams = out.filter(p => p.source === 'Header');
    expect(headerParams.length).toBe(1);
    expect(headerParams[0].key).toBe('header:X-Good');
  });

  test('enumerates URL path segments as Path source', () => {
    const sdk = makeSdk();
    const spec = uniqueSpec({ path: '/api/myvalue123' });
    (spec as any).getPath = () => '/api/myvalue123';
    const out = enumerateRequestParameters(spec, sdk, 200, false);
    const pathParams = out.filter(p => p.source === 'Path');
    // "api" is in COMMON_PATH_SEGMENTS, only "myvalue123" passes
    expect(pathParams.length).toBe(1);
    expect(pathParams[0].key).toBe('path:1:myvalue123');
    expect(pathParams[0].value).toBe('myvalue123');
  });

  test('skips short and common path segments', () => {
    const sdk = makeSdk();
    const spec = uniqueSpec({ path: '/api/users/12345/profile-data' });
    (spec as any).getPath = () => '/api/users/12345/profile-data';
    const out = enumerateRequestParameters(spec, sdk, 200, false);
    const pathParams = out.filter(p => p.source === 'Path');
    // "api" is common, "users" is common, "12345" is numeric, "profile-data" passes
    expect(pathParams.length).toBe(1);
    expect(pathParams[0].value).toBe('profile-data');
  });

  test('path segment key encodes segment index for mutation', () => {
    const sdk = makeSdk();
    const spec = uniqueSpec();
    (spec as any).getPath = () => '/section/myvalue/detail';
    const out = enumerateRequestParameters(spec, sdk, 200, false);
    const pathParams = out.filter(p => p.source === 'Path');
    const myvalue = pathParams.find(p => p.value === 'myvalue');
    expect(myvalue).toBeDefined();
    expect(myvalue!.key).toBe('path:1:myvalue');
    const detail = pathParams.find(p => p.value === 'detail');
    expect(detail).toBeDefined();
    expect(detail!.key).toBe('path:2:detail');
  });
});
