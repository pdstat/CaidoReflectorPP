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

const MIN_HEADER_VALUE_LEN = 6;

const MIN_PATH_SEGMENT_LEN = 4;

const COMMON_PATH_SEGMENTS = new Set([
  'api', 'app', 'www', 'web', 'src', 'lib', 'bin',
  'css', 'img', 'font', 'fonts', 'dist', 'build',
  'static', 'assets', 'public', 'images', 'scripts',
  'styles', 'index', 'login', 'admin', 'home', 'page',
  'pages', 'user', 'users', 'auth', 'test', 'docs',
  'help', 'blog', 'post', 'posts', 'tags', 'tag',
  'categories', 'category', 'search', 'about', 'contact',
  'null', 'true', 'false', 'undefined'
]);

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

  // Body (x-www-form-urlencoded only)
  if (method === 'POST' && spec.getBody?.()) {
    const bodyObj = spec.getBody(); const ct = spec.getHeader?.('Content-Type');
    if (ct && ct[0]?.includes('application/x-www-form-urlencoded')) {
      for (const pair of bodyObj.toText().split('&')) {
        if (!pair) continue; const eq = pair.indexOf('='); if (eq === -1) continue;
        const key = pair.slice(0, eq).trim(); const value = pair.slice(eq + 1);
        push({ key, value, source: 'Body', method, code: respCode });
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
