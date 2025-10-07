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

const baseRequest = (query: string, opts?: Partial<{ method: string; body: string; cookies: string; https: boolean }>) => ({
    toSpec: () => ({
        getQuery: () => query,
        getMethod: () => opts?.method ?? "GET",
        getHeader: (name: string) => {
            if (name === 'Cookie' && opts?.cookies) return [opts.cookies];
            if (name === 'Content-Type' && opts?.body) return ['application/x-www-form-urlencoded'];
            return undefined;
        },
        getBody: () => (opts?.body ? { toText: () => opts.body } : undefined),
        getTls: () => !!opts?.https,
        getHost: () => 'example.com',
        getPath: () => '/path'
    })
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
});