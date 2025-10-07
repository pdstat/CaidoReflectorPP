import { enumerateRequestParameters } from "../src/utils/params.js";

// Helper to build a minimal spec-like object
const makeSpec = (opts: Partial<{
  query: string;
  method: string;
  cookies: string;
  body: string;
  contentType: string;
  https: boolean;
}> = {}) => ({
  getQuery: () => opts.query,
  getMethod: () => opts.method || (opts.body ? 'POST' : 'GET'),
  getHeader: (name: string) => {
    if (name === 'Cookie' && opts.cookies) return [opts.cookies];
    if (name === 'Content-Type' && opts.contentType) return [opts.contentType];
    return undefined;
  },
  getBody: () => (opts.body ? { toText: () => opts.body } : undefined),
  getTls: () => !!opts.https,
  getHost: () => 'example.com',
  getPath: () => '/a'
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
    const spec: any = { getQuery: () => '', getMethod: () => 'GET', getHeader: () => undefined, getBody: () => undefined, getTls: () => false, getHost: () => 'example.com', getPath: () => '/empty' };
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
});
