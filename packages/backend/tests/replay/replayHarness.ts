// Offline replay harness for the finding-audit self-improving loop.
//
// A finding's `confirmed`/chars/severity are decided by *probe* responses that are sent
// live during detection and never stored. A single captured request/response therefore
// cannot reproduce a confirmed verdict offline. This harness closes that gap by modelling
// the server's reflection behaviour as a transformation, not by replaying fixed bytes:
// each fixture is a tiny "mock vulnerable server" that, for ANY probe value the real
// detection code injects (random markers included), regenerates the response by inserting
// the (decoded) injected value into a captured template and applying a per-character
// escaping map observed at capture time.
//
// The harness drives the REAL detection functions (checkBodyReflections /
// checkHeaderReflections) through a mocked `sdk.requests.send`, exactly as the existing
// unit tests do, so a fixture is a permanent, deterministic regression fixture for a real
// finding without needing the live target on re-runs.

import { checkBodyReflections } from "../../src/analysis/bodyReflection/bodyReflection.js";
import { checkHeaderReflections } from "../../src/analysis/headerReflection.js";
import { ConfigStore } from "../../src/stores/configStore.js";

// Mirror of packages/frontend/src/core/constants.ts NO_SNIFF_CONTENT_TYPES. The backend has
// no built-in default -- the frontend pushes this set at runtime -- so the harness must seed
// it to reproduce production gating. Keep in sync with the frontend list.
export const DEFAULT_NO_SNIFF_CONTENT_TYPES = [
  "text/html", "application/xhtml+xml", "application/xml", "text/xml", "image/svg+xml",
  "text/xsl", "application/vnd.wap.xhtml+xml", "multipart/x-mixed-replace", "application/rdf+xml",
  "application/mathml+xml", "application/json", "text/vtt", "text/cache-manifest",
  "model/vnd.usdz+zip", "video/mp2t", "text/x-component",
];

export type EscapeMode = "raw" | "drop" | "htmlentity" | "backslash" | "percent";

export interface ReflectionSpec {
  /** Where the reflected parameter comes from. */
  source: "URL" | "Body" | "BodyJsonRaw";
  /** The parameter name the value is carried in (URL/Body). */
  param: string;
  /** For BodyJsonRaw: the JSON path to the reflected string leaf in the request body. */
  jsonPath?: string[];
  /**
   * Response body with every occurrence of the reflected value replaced by the sentinel
   * `__REFLECT__`. The prober substitutes the (transformed) injected value back in.
   */
  bodyTemplate?: string;
  /** Same idea for response headers (e.g. { Location: "https://h/p?x=__REFLECT__" }). */
  headerTemplates?: Record<string, string>;
  /**
   * Per-character transformation the server applies to the reflected value. `sequences`
   * replaces multi-char sequences after the per-char pass (e.g. { "</": "\\u003C/" } for a
   * serializer that escapes "</" while a lone "<" survives).
   */
  escape?: {
    default?: EscapeMode;
    map?: Record<string, EscapeMode>;
    sequences?: Record<string, string>;
  };
}

export interface ReplayFixture {
  /** Human label, e.g. the endpoint or finding id this was captured from. */
  name: string;
  request: {
    query?: string;
    body?: string;
    method?: string;
    cookies?: string;
    https?: boolean;
    host?: string;
    path?: string;
    contentType?: string;
  };
  /** The recorded baseline response (pre-probe). */
  baseline: {
    body?: string;
    code?: number;
    headers?: Record<string, string | string[]>;
  };
  reflection: ReflectionSpec;
  /**
   * Plugin configuration in effect when the finding was produced. Part of faithfully
   * reproducing a finding offline. Defaults to production defaults when omitted.
   */
  config?: {
    noSniffContentTypes?: string[];
    checkJsResponseReflections?: boolean;
  };
}

const SENTINEL = "__REFLECT__";

const htmlEntity = (ch: string): string => {
  switch (ch) {
    case "<": return "&lt;";
    case ">": return "&gt;";
    case "&": return "&amp;";
    case '"': return "&quot;";
    case "'": return "&#39;";
    default: return ch;
  }
};

const transformChar = (ch: string, mode: EscapeMode): string => {
  switch (mode) {
    case "raw": return ch;
    case "drop": return "";
    case "htmlentity": return htmlEntity(ch);
    case "backslash": return "\\" + ch;
    case "percent": return encodeURIComponent(ch);
    default: return ch;
  }
};

const applyEscape = (value: string, escape?: ReflectionSpec["escape"]): string => {
  const map = escape?.map ?? {};
  const def: EscapeMode = escape?.default ?? "raw";
  let out = "";
  for (const ch of value) out += transformChar(ch, map[ch] ?? def);
  for (const [seq, replacement] of Object.entries(escape?.sequences ?? {})) {
    out = out.split(seq).join(replacement);
  }
  return out;
};

const safeDecode = (v: string): string => {
  try { return decodeURIComponent(v.replace(/\+/g, "%20")); } catch { return v; }
};

/** Extract the current value of the reflected param from a mutated request spec. */
const extractInjected = (spec: any, reflection: ReflectionSpec): string | undefined => {
  if (reflection.source === "BodyJsonRaw") {
    const body = spec.getBody?.()?.toText?.() || "";
    try {
      let target: any = JSON.parse(body);
      for (const seg of reflection.jsonPath ?? []) {
        target = target[/^\d+$/.test(seg) ? parseInt(seg, 10) : seg];
        if (target == null) return undefined;
      }
      return typeof target === "string" ? target : undefined;
    } catch { return undefined; }
  }
  const raw = reflection.source === "Body"
    ? (spec.getBody?.()?.toText?.() || "")
    : (spec.getQuery?.() || "");
  for (const pair of raw.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq) === reflection.param) return safeDecode(pair.slice(eq + 1));
  }
  return undefined;
};

const substitute = (template: string, injected: string, escape?: ReflectionSpec["escape"]): string =>
  template.split(SENTINEL).join(applyEscape(injected, escape));

/**
 * Build a mocked SDK whose `requests.send` behaves like the fixture's vulnerable server:
 * it reads the probe's injected value, transforms it per the escape map, and reflects it
 * into the body/header templates. This is what makes confirmation deterministic offline.
 */
export const buildReplaySdk = (fixture: ReplayFixture) => ({
  console: { log: () => {} },
  requests: {
    send: async (spec: any) => {
      const injected = extractInjected(spec, fixture.reflection) ?? "";
      const r = fixture.reflection;
      const body = r.bodyTemplate != null
        ? substitute(r.bodyTemplate, injected, r.escape)
        : (fixture.baseline.body ?? "");
      const headers: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(fixture.baseline.headers ?? {})) headers[k] = v;
      for (const [k, tpl] of Object.entries(r.headerTemplates ?? {})) {
        headers[k] = substitute(tpl, injected, r.escape);
      }
      return {
        response: {
          getCode: () => fixture.baseline.code ?? 200,
          getBody: () => ({ toText: () => body }),
          getHeaders: () => headers,
          getHeader: (name: string) => {
            const h = headers[name];
            if (h == null) return undefined;
            return Array.isArray(h) ? h : [h];
          },
        },
      };
    },
  },
}) as any;

const buildRequest = (fixture: ReplayFixture) => ({
  toSpec: () => {
    let query = fixture.request.query ?? "";
    let body = fixture.request.body ?? "";
    let path = fixture.request.path ?? "/path";
    return {
      getQuery: () => query,
      setQuery: (q: string) => { query = q; },
      getMethod: () => fixture.request.method ?? (body ? "POST" : "GET"),
      getHeader: (name: string) => {
        if (name === "Cookie" && fixture.request.cookies) return [fixture.request.cookies];
        if (name === "Content-Type") {
          if (fixture.request.contentType) return [fixture.request.contentType];
          if (body) return ["application/x-www-form-urlencoded"];
        }
        return undefined;
      },
      getBody: () => (body ? { toText: () => body } : undefined),
      setBody: (v: string) => { body = v; },
      getTls: () => !!fixture.request.https,
      getHost: () => fixture.request.host ?? "example.com",
      getPath: () => path,
      setPath: (p: string) => { path = p; },
    };
  },
});

const buildBaselineResponse = (fixture: ReplayFixture) => ({
  getCode: () => fixture.baseline.code ?? 200,
  getBody: () => ({ toText: () => fixture.baseline.body ?? "" }),
  getHeaders: () => fixture.baseline.headers ?? {},
  getHeader: (name: string) => {
    const h = fixture.baseline.headers?.[name];
    if (h == null) return undefined;
    return Array.isArray(h) ? h : [h];
  },
});

export interface ReplayResult {
  body: any[];
  header: any[];
}

/**
 * Run a fixture through the real detection code and return the body + header findings
 * (AnalyzedReflectedParameter[]). Assert on context / severity / confirmed / chars to
 * regression-test a captured real-world case without the live target.
 */
export const runFixture = async (fixture: ReplayFixture): Promise<ReplayResult> => {
  // Seed plugin config to match the environment the finding was produced in.
  ConfigStore.setNoSniffContentTypes(
    new Set(fixture.config?.noSniffContentTypes ?? DEFAULT_NO_SNIFF_CONTENT_TYPES)
  );
  ConfigStore.setCheckJsResponseReflections(fixture.config?.checkJsResponseReflections ?? true);
  const sdk = buildReplaySdk(fixture);
  const request = buildRequest(fixture);
  const response = buildBaselineResponse(fixture);
  const body = await checkBodyReflections({ request, response }, sdk);
  const header = await checkHeaderReflections(request, response, sdk);
  return { body, header };
};
