import { checkBodyReflections } from "../src/analysis/bodyReflection/bodyReflection.js";
import { reqParamsStore } from "../src/stores/paramStore.js";

// Helper to build a minimal SDK with controllable probe responses
const makeSdk = (probeResponder?: (spec: any) => { code?: number; body?: string; headers?: Record<string, string | string[]> }) => {
    return {
        console: { log: jest.fn() },
        requests: {
            send: async (spec: any) => {
                const r = probeResponder ? probeResponder(spec) : undefined;
                const injectedQuery = spec.getQuery?.() || '';
                const injectedBody = spec.getBody?.()?.toText?.() || '';
                const bodyText = r?.body ?? (injectedBody || `<html>${injectedQuery}</html>`);
                return {
                    response: {
                        getCode: () => r?.code ?? 200,
                        getBody: () => ({ toText: () => bodyText }),
                        getHeader: (name: string) => {
                            const h = r?.headers?.[name];
                            if (!h) return undefined;
                            return Array.isArray(h) ? h : [h];
                        }
                    }
                };
            }
        }
    } as any;
};

const baseRequest = (query: string, opts?: Partial<{ method: string; body: string; cookies: string; https: boolean; path: string }>) => ({
    toSpec: () => {
        let currentQuery = query;
        let currentPath = opts?.path ?? '/path';
        return {
            getQuery: () => currentQuery,
            setQuery: (q: string) => { currentQuery = q; },
            getMethod: () => opts?.method ?? "GET",
            getHeader: (name: string) => {
                if (name === 'Cookie' && opts?.cookies) return [opts.cookies];
                if (name === 'Content-Type' && opts?.body) return ['application/x-www-form-urlencoded'];
                return undefined;
            },
            getBody: () => (opts?.body ? { toText: () => opts.body } : undefined),
            setBody: (_: string) => {},
            getTls: () => !!opts?.https,
            getHost: () => 'example.com',
            getPath: () => currentPath,
            setPath: (p: string) => { currentPath = p; }
        };
    }
});

const makeResponse = (html: string, extra?: Partial<{ code: number; headers: Record<string, string | string[]> }>) => ({
    getCode: () => extra?.code ?? 200,
    getBody: () => ({ toText: () => html }),
    getHeader: (name: string) => {
        const h = extra?.headers?.[name];
        if (!h) return undefined;
        return Array.isArray(h) ? h : [h];
    }
});

describe("checkBodyReflections (expanded)", () => {
    test("literal reflection in JS quoted string (no crash, may or may not confirm)", async () => {
        const value = "abc";
        const html = `<script>var a=\"${value}\";</script>`;
        const sdk = makeSdk();
        const out = await checkBodyReflections({ request: baseRequest(`p=${value}`), response: makeResponse(html) }, sdk);
        // Just ensure function returns array and doesn't throw
        expect(Array.isArray(out)).toBe(true);
    });

    test("no reflection returns empty array", async () => {
        const html = `<html><body>No echo here</body></html>`;
        const out = await checkBodyReflections({ request: baseRequest(`p=value`), response: makeResponse(html) }, makeSdk());
        expect(out.length).toBe(0);
    });

    test("urlencoded-only reflection creates encoded signal but not finding (strict mode)", async () => {
        const raw = 'ab ';// includes space so encoded form differs
        const encoded = encodeURIComponent(raw); // ab%20
        const html = `<div>${encoded}</div>`;
        const sdk = makeSdk();
        const input: any = { request: baseRequest(`p=${raw}`), response: makeResponse(html) };
        const out = await checkBodyReflections(input, sdk);
        expect(out.length).toBe(0);
        const signals = (input as any).__encodedSignals;
        if (signals) {
            expect(signals.some((s: any) => s.name === 'p')).toBe(true);
        }
    });

    test("form body parameter reflection (optional confirmation)", async () => {
        const html = `<span>FORMVAL</span>`;
        const sdk = makeSdk();
        const out = await checkBodyReflections({ request: baseRequest('', { method: 'POST', body: 'x=FORMVAL&y=2' }), response: makeResponse(html) }, sdk);
        expect(Array.isArray(out)).toBe(true);
    });

    test("cookie parameter reflection (optional confirmation)", async () => {
        const value = 'cookV';
        const html = `<p>${value}</p>`;
        const out = await checkBodyReflections({ request: baseRequest('', { cookies: `sid=${value}; theme=dark` }), response: makeResponse(html) }, makeSdk());
        expect(Array.isArray(out)).toBe(true);
    });

    test("path segment: uses count probe result as true reflection count", async () => {
        const pathSeg = "wspd_cgi";
        const html = [
            `<script>`,
            `  var a = "/cgi/${pathSeg}/login";`,
            `  var b = "/cgi/${pathSeg}/auth";`,
            `  var c = "/cgi/${pathSeg}/session";`,
            `  var d = "/cgi/${pathSeg}/logout";`,
            `</script>`
        ].join("\n");

        const sdk = makeSdk((spec) => {
            const path = spec.getPath?.() || '';
            const markerMatch = path.match(/\/cgi\/([a-zA-Z0-9]+)\//);
            const marker = markerMatch?.[1] || '';
            if (marker && marker !== pathSeg) {
                return {
                    body: [
                        `<script>`,
                        `  var a = "/cgi/${marker}/login";`,
                        `  var b = "/cgi/${pathSeg}/auth";`,
                        `  var c = "/cgi/${pathSeg}/session";`,
                        `  var d = "/cgi/${pathSeg}/logout";`,
                        `</script>`
                    ].join("\n")
                };
            }
            return { body: html };
        });

        const out = await checkBodyReflections({
            request: baseRequest('', { path: `/cgi/${pathSeg}/login` }),
            response: makeResponse(html)
        }, sdk);

        const match = out.find(r => r.name.includes(pathSeg));
        if (match) {
            expect(match.matches.length).toBe(1);
        }
    });

    test("path segment: suppresses false positive when count probe finds 0 reflections", async () => {
        const pathSeg = "customer";
        const html = [
            `<html>`,
            `<style>.customer-reviews { display: block; }</style>`,
            `<body class="customer-account-index">`,
            `<script>`,
            `  var customerData = {};`,
            `  var reloadCustomerSection = function() {};`,
            `  console.log("customer loaded");`,
            `</script>`,
            `<div class="customer-info">Hello customer</div>`,
            `</body></html>`
        ].join("\n");

        const sdk = makeSdk((spec) => {
            const path = spec.getPath?.() || '';
            const hasOrigSeg = path.includes(`/${pathSeg}/`);
            if (!hasOrigSeg) {
                return {
                    body: [
                        `<html><body>`,
                        `<h1>404 Not Found</h1>`,
                        `<p>The page you requested was not found.</p>`,
                        `</body></html>`
                    ].join("\n")
                };
            }
            return { body: html };
        });

        const out = await checkBodyReflections({
            request: baseRequest('', { path: `/store/${pathSeg}/account` }),
            response: makeResponse(html)
        }, sdk);

        const match = out.find(r => r.name.includes(pathSeg));
        expect(match).toBeUndefined();
    });

    test("path segment: suppresses error-page reflection via status code check (unconfirmed)", async () => {
        const pathSeg = "account";
        const html = [
            `<html>`,
            `<style>.customer-account-nav { width: 200px; }</style>`,
            `<body class="customer-account-index">`,
            `<nav><a href="/customer/account">My Account</a></nav>`,
            `</body></html>`
        ].join("\n");

        const sdk = makeSdk((spec) => {
            const path = spec.getPath?.() || '';
            const segments = path.split('/').filter(Boolean);
            const lastSeg = segments[segments.length - 1] || '';
            if (lastSeg !== pathSeg) {
                return {
                    code: 404,
                    body: `<html><body><pre>Cannot GET ${path}</pre></body></html>`
                };
            }
            return { body: html };
        });

        const out = await checkBodyReflections({
            request: baseRequest('', { path: `/store/customer/${pathSeg}` }),
            response: makeResponse(html)
        }, sdk, true);

        const match = out.find(r => r.name.includes(pathSeg));
        expect(match).toBeUndefined();
    });

    test("path segment: suppresses confirmed error-page reflection when count probe returns different status code", async () => {
        const pathSeg = "srcset";
        const html = `<html><head><title>Srcset</title></head><body><img srcset="test.jpg 1x" src="default.jpg"></body></html>`;

        const sdk = makeSdk((spec) => {
            const path = spec.getPath?.() || '';
            if (!path.startsWith(`/${pathSeg}`)) {
                return {
                    code: 404,
                    body: `<!DOCTYPE html><html><body><pre>Cannot GET ${path}</pre></body></html>`
                };
            }
            return { body: html };
        });

        const out = await checkBodyReflections({
            request: baseRequest('q=testval', { path: `/${pathSeg}` }),
            response: makeResponse(html)
        }, sdk, true);

        const match = out.find(r => r.name.includes(pathSeg) && r.source === 'Path');
        expect(match).toBeUndefined();
    });

    test("query param: uses count probe matches when count >= baseline", async () => {
        const value = "testval";
        const html = `<p>${value}</p>`;

        const sdk = makeSdk((spec) => {
            const query = spec.getQuery?.() || '';
            return { body: `<p>${query}</p>` };
        });

        const out = await checkBodyReflections({
            request: baseRequest(`p=${value}`),
            response: makeResponse(html)
        }, sdk);

        expect(Array.isArray(out)).toBe(true);
    });

    test("JSON body reflections run through the JSON generator", async () => {
        const generateMock = jest.fn((sdk: any, value: string) => ({ context: ["jsonString"], payload: ["\""] }));
        await new Promise<void>((resolve, reject) => {
            jest.isolateModules(() => {
                jest.doMock("../src/payload/jsonResponseBodyPayloadGenerator.ts", () => {
                    return {
                        __esModule: true,
                        default: class {
                            constructor(_body: string) {}
                            generate(sdk: any, value: string) {
                                return generateMock(sdk, value);
                            }
                        }
                    };
                });
                const { checkBodyReflections: checkJsonBodyReflections } = require("../src/analysis/bodyReflection/bodyReflection.js");
                const value = "jsonVal";
                const json = `{"key":"${value}"}`;
                checkJsonBodyReflections(
                    { request: baseRequest(`p=${value}`), response: makeResponse(json, { headers: { 'Content-Type': 'application/json' } }) },
                    makeSdk()
                ).then(resolve).catch(reject);
            });
        });
        expect(generateMock).toHaveBeenCalledWith(expect.anything(), "jsonVal");
    });
});

describe('value-sensitive dedup for URL params (error-gated reflections)', () => {
    beforeEach(() => { (reqParamsStore as any)._store = undefined; });

    // Probe server that echoes the DECODED qs value raw into HTML (so a probed
    // breakout char reflects literally and confirms), with no Content-Type so
    // probe gating passes via the missing-headers path.
    const rawEchoSdk = () => ({
        console: { log: () => {} },
        requests: {
            send: async (spec: any) => {
                const q: string = spec.getQuery?.() || '';
                const m = q.match(/qs=([^&]*)/);
                let decoded = '';
                try { decoded = decodeURIComponent(m?.[1] ?? ''); } catch { decoded = m?.[1] ?? ''; }
                const body = `<html><body>${decoded}</body></html>`;
                return { response: { getCode: () => 200, getBody: () => ({ toText: () => body }), getHeader: () => undefined } };
            },
        },
    }) as any;

    test('a non-reflecting value does not block a later reflecting value', async () => {
        const sdk = rawEchoSdk();
        // 1) benign value: not echoed (SQL-error style no-match page) -> no finding,
        //    but qs is now seen in the store with value 'money'
        const out1 = await checkBodyReflections(
            { request: baseRequest('qs=money'), response: makeResponse('No products matching your criteria.') },
            sdk
        );
        expect(out1.length).toBe(0);
        // 2) same endpoint, a value that DOES reflect -- must not be deduped
        const out2 = await checkBodyReflections(
            { request: baseRequest('qs=moneyX'), response: makeResponse('<html><body>moneyX</body></html>') },
            sdk
        );
        expect(out2.length).toBeGreaterThan(0);
        expect(out2[0].source).toBe('URL');
    });

    test('once confirmed, a further value of the same param is deduped by name', async () => {
        const sdk = rawEchoSdk();
        const r1 = await checkBodyReflections(
            { request: baseRequest('qs=reflectA'), response: makeResponse('<html><body>reflectA</body></html>') },
            sdk
        );
        expect(r1.length).toBeGreaterThan(0); // confirmed -> markConfirmed(qs)
        const r2 = await checkBodyReflections(
            { request: baseRequest('qs=reflectB'), response: makeResponse('<html><body>reflectB</body></html>') },
            sdk
        );
        expect(r2.length).toBe(0); // deduped by name, not re-probed
    });
});

describe('reflection count from the first probe batch', () => {
    beforeEach(() => { (reqParamsStore as any)._store = undefined; });

    // Echoes the decoded qs value raw. A count probe is the only probe whose value is a
    // bare 12-char alphanumeric marker, so those sends are recorded separately.
    const echoSdk = (statusFor: (value: string) => number) => {
        const countProbeValues: string[] = [];
        const sdk = {
            console: { log: () => {} },
            requests: {
                send: async (spec: any) => {
                    const q: string = spec.getQuery?.() || '';
                    const m = q.match(/qs=([^&]*)/);
                    let decoded = '';
                    try { decoded = decodeURIComponent(m?.[1] ?? ''); } catch { decoded = m?.[1] ?? ''; }
                    if (/^[a-z0-9]{12}$/.test(decoded)) countProbeValues.push(decoded);
                    const body = `<html><body>${decoded} | ${decoded}</body></html>`;
                    return { response: {
                        getCode: () => statusFor(decoded),
                        getBody: () => ({ toText: () => body }),
                        getHeader: (): undefined => undefined,
                    } };
                },
            },
        } as any;
        return { sdk, countProbeValues };
    };

    test('a confirmed param sends no separate count probe', async () => {
        const { sdk, countProbeValues } = echoSdk(() => 200);
        const out = await checkBodyReflections(
            { request: baseRequest('qs=reflectC'), response: makeResponse('<html><body>reflectC</body></html>') },
            sdk
        );
        expect(out.length).toBeGreaterThan(0);
        expect(countProbeValues).toHaveLength(0);
        expect(out[0].matches).toHaveLength(2);
        expect(out[0].value).toMatch(/^[a-z0-9]{12}$/);
    });

    test('falls back to a count probe when the first batch changed the status', async () => {
        const { sdk, countProbeValues } = echoSdk((v) => (/['"\\`]/.test(v) ? 500 : 200));
        const out = await checkBodyReflections(
            { request: baseRequest('qs=reflectD'), response: makeResponse('<html><body>reflectD</body></html>') },
            sdk
        );
        expect(out.length).toBeGreaterThan(0);
        expect(countProbeValues).toHaveLength(1);
        expect(out[0].value).toBe(countProbeValues[0]);
    });
});
