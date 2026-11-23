import { RequestParameter } from "../core/types.js";
import { buildEndpoint } from "./http.js";
import { reqParamsStore } from "../stores/paramStore.js";
import { TrackedParam } from "../stores/trackedParam.js";
import { ConfigStore } from "../stores/configStore.js";

const CHECKED_REQUEST_HEADERS = [
  'User-Agent', 'Referer', 'X-Forwarded-For',
  'X-Forwarded-Host', 'Origin', 'Accept-Language'
];

const SKIP_REQUEST_HEADERS = new Set([
  'host', 'cookie', 'authorization', 'proxy-authorization',
  'content-type', 'content-length', 'accept', 'accept-encoding',
  'connection', 'upgrade', 'sec-fetch-dest', 'sec-fetch-mode',
  'sec-fetch-site', 'sec-fetch-user', 'sec-ch-ua',
  'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'if-modified-since', 'if-none-match', 'cache-control',
  'pragma', 'te', 'transfer-encoding'
]);

// Minimum length for a reflected request-header value to be tracked. Headers
// alone are gated (query/cookie params are not) because short header values
// match common substrings; 4 keeps realistic short values (e.g. 'en-US',
// short IPs) while filtering 1-3 char noise. Coincidental short matches still
// fail probe confirmation, so this only trades coverage against probe volume.
const MIN_HEADER_VALUE_LEN = 4;

const MIN_JSON_STRING_LEN = 4;
const MAX_JSON_PARAMS = 20;
const MAX_JSON_DEPTH = 5;

const MIN_PATH_SEGMENT_LEN = 4;

// Structural path segments only: infrastructure, build/asset dirs, framework
// names, and JS literals -- segments that are route plumbing, never a
// meaningful reflection target. Application words (search, admin, login, user,
// config, page, ...) are deliberately NOT skipped: a reflected app segment is
// a real finding, and the Path count-probe already suppresses natural-word
// false positives (a segment that only appears as page text reflects 0 times).
const COMMON_PATH_SEGMENTS = new Set([
  'api', 'app', 'www', 'web', 'src', 'lib', 'bin',
  'css', 'img', 'font', 'fonts', 'dist', 'build',
  'static', 'assets', 'public', 'images', 'scripts',
  'styles', 'index',
  'null', 'true', 'false', 'undefined',
  'next', 'react', 'vue', 'angular', 'svelte', 'node',
  'modules', 'components', 'views', 'layout', 'layouts',
]);

interface JsonSubParam {
  key: string;
  value: string;
  parentKey: string;
  jsonPath: string[];
}

function buildJsonPathDisplay(path: string[]): string {
  return path.reduce((acc, p) => {
    if (/^\d+$/.test(p)) return `${acc}[${p}]`;
    return acc ? `${acc}.${p}` : p;
  }, '');
}

function extractJsonStringValues(
  parentKey: string,
  rawValue: string
): JsonSubParam[] {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawValue.replace(/\+/g, ' '));
  } catch {
    return [];
  }
  const first = decoded.trimStart()[0];
  if (first !== '{' && first !== '[') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  return collectJsonStringLeaves(parsed).map((leaf) => ({
    key: `${parentKey}.${leaf.display}`,
    value: leaf.value,
    parentKey,
    jsonPath: leaf.jsonPath
  }));
}

interface JsonLeaf { display: string; value: string; jsonPath: string[]; }

// Walk a parsed JSON value and collect its string leaves (path + value), bounded by the
// same depth/count/length limits as extractJsonStringValues. Shared by the query/form-JSON
// path (which URL-decodes first) and the raw application/json request-body path.
function collectJsonStringLeaves(parsed: unknown): JsonLeaf[] {
  const results: JsonLeaf[] = [];
  function walk(obj: unknown, path: string[], depth: number) {
    if (depth > MAX_JSON_DEPTH) return;
    if (results.length >= MAX_JSON_PARAMS) return;
    if (typeof obj === 'string') {
      if (obj.length >= MIN_JSON_STRING_LEN) {
        results.push({ display: buildJsonPathDisplay(path), value: obj, jsonPath: [...path] });
      }
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) walk(obj[i], [...path, String(i)], depth + 1);
      return;
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const [k, v] of Object.entries(obj)) walk(v, [...path, k], depth + 1);
    }
  }
  walk(parsed, [], 0);
  return results;
}

// Unified parameter enumeration (URL query, Cookie, body, request headers, path segments)
// Set track=false to avoid paramStore mutations (e.g., header-only scans)
export function enumerateRequestParameters(requestOrSpec: any, sdk: any, responseCode?: number, track: boolean = true): RequestParameter[] {
  const spec = typeof requestOrSpec?.toSpec === 'function' ? requestOrSpec.toSpec() : requestOrSpec;
  if (!spec) return [];
  const params: RequestParameter[] = [];
  const endpoint = buildEndpoint(spec);
  const respCode = typeof responseCode === 'number' ? responseCode : 0;
  const store = reqParamsStore.get();
  const method = spec.getMethod?.() || 'GET';

  const push = (candidate: TrackedParam) => {
    if (track) {
      if (!candidate.key || store.paramTested(endpoint, candidate)) return;
      store.addParam(endpoint, candidate);
    }
    params.push({ key: candidate.key, value: candidate.value, source: candidate.source as any, method: candidate.method, code: candidate.code });
  };

  // Query
  const rawQuery = spec.getQuery?.();
  if (rawQuery) {
    for (const pair of rawQuery.split('&')) {
      if (!pair) continue; const eq = pair.indexOf('='); if (eq === -1) continue;
      const key = pair.slice(0, eq); const value = pair.slice(eq + 1);
      push({ key, value, source: 'URL', method, code: respCode });

      const jsonSubs = extractJsonStringValues(key, value);
      for (const sub of jsonSubs) {
        const candidate: TrackedParam = {
          key: sub.key, value: sub.value,
          source: 'UrlJson', method, code: respCode
        };
        if (track) {
          if (!candidate.key || store.paramTested(endpoint, candidate)) continue;
          store.addParam(endpoint, candidate);
        }
        params.push({
          key: sub.key, value: sub.value, source: 'UrlJson',
          method, code: respCode,
          parentKey: sub.parentKey, jsonPath: sub.jsonPath
        });
      }
    }
  }

  // Cookies
  const cookiesHeader = spec.getHeader?.('Cookie')?.join('; ') ?? '';
  if (cookiesHeader) {
    for (const cookie of cookiesHeader.split(';')) {
      const eq = cookie.indexOf('='); if (eq === -1) continue;
      const key = cookie.slice(0, eq).trim(); const value = cookie.slice(eq + 1).trim();
      push({ key, value, source: 'Cookie', method, code: respCode });
    }
  }

  // Body
  if (method === 'POST' && spec.getBody?.()) {
    const bodyObj = spec.getBody(); const ct = spec.getHeader?.('Content-Type');
    // Raw application/json body: walk the whole body and enumerate its string leaves. The
    // plugin was blind to JSON APIs (RTB/GraphQL/etc.) that reflect request-body values.
    if (ct && ct[0]?.includes('application/json')) {
      const text = bodyObj.toText?.() ?? '';
      const first = text.trimStart()[0];
      if (first === '{' || first === '[') {
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = undefined; }
        if (parsed && typeof parsed === 'object') {
          for (const leaf of collectJsonStringLeaves(parsed)) {
            const candidate: TrackedParam = {
              key: `body.${leaf.display}`, value: leaf.value,
              source: 'BodyJsonRaw', method, code: respCode
            };
            if (track) {
              if (!candidate.key || store.paramTested(endpoint, candidate)) continue;
              store.addParam(endpoint, candidate);
            }
            params.push({
              key: `body.${leaf.display}`, value: leaf.value, source: 'BodyJsonRaw',
              method, code: respCode, jsonPath: leaf.jsonPath
            });
          }
        }
      }
    }
    if (ct && ct[0]?.includes('application/x-www-form-urlencoded')) {
      for (const pair of bodyObj.toText().split('&')) {
        if (!pair) continue; const eq = pair.indexOf('='); if (eq === -1) continue;
        const key = pair.slice(0, eq).trim(); const value = pair.slice(eq + 1);
        push({ key, value, source: 'Body', method, code: respCode });

        const jsonSubs = extractJsonStringValues(key, value);
        for (const sub of jsonSubs) {
          const candidate: TrackedParam = {
            key: sub.key, value: sub.value,
            source: 'BodyJson', method, code: respCode
          };
          if (track) {
            if (!candidate.key || store.paramTested(endpoint, candidate)) continue;
            store.addParam(endpoint, candidate);
          }
          params.push({
            key: sub.key, value: sub.value, source: 'BodyJson',
            method, code: respCode,
            parentKey: sub.parentKey, jsonPath: sub.jsonPath
          });
        }
      }
    }
  }

  // Request headers reflected in response body
  if (ConfigStore.getCheckRequestHeaderReflections()) {
    const seenHeaders = new Set<string>();

    const tryHeader = (name: string) => {
      const lower = name.toLowerCase();
      if (seenHeaders.has(lower)) return;
      const vals = spec.getHeader?.(name);
      const value = Array.isArray(vals) ? vals[0] : vals;
      if (!value || value.length < MIN_HEADER_VALUE_LEN) return;
      seenHeaders.add(lower);
      push({
        key: `header:${name}`,
        value,
        source: 'Header',
        method,
        code: respCode
      });
    };

    for (const name of CHECKED_REQUEST_HEADERS) {
      tryHeader(name);
    }

    // Also check any custom/non-standard headers via getHeaders()
    const allHeaders: Record<string, string | string[]> =
      typeof spec.getHeaders === 'function' ? spec.getHeaders() : {};
    for (const name of Object.keys(allHeaders)) {
      const lower = name.toLowerCase();
      if (SKIP_REQUEST_HEADERS.has(lower)) continue;
      if (lower.startsWith('sec-')) continue;
      tryHeader(name);
    }
  }

  // URL path segments reflected in response body
  if (ConfigStore.getCheckPathSegmentReflections()) {
    const path = spec.getPath?.() || '';
    const segments = path.split('/').filter(Boolean);
    for (let i = 0; i < segments.length; i++) {
      const seg = decodeURIComponent(segments[i]);
      if (seg.length < MIN_PATH_SEGMENT_LEN) continue;
      if (COMMON_PATH_SEGMENTS.has(seg.toLowerCase())) continue;
      if (/^\d+$/.test(seg)) continue;
      push({
        key: `path:${i}:${seg}`,
        value: seg,
        source: 'Path',
        method,
        code: respCode
      });
    }
  }

  if (params.length === 0) sdk?.console?.log?.('[Reflector++] No (new) parameters found');
  return params;
}
