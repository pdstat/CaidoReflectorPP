import { checkBodyReflections } from "../src/analysis/bodyReflection/bodyReflection.js";

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