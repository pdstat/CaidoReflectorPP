import { RequestParameter } from "../core/types.js";
import { buildEndpoint } from "./http.js";
import { reqParamsStore } from "../stores/paramStore.js";
import { TrackedParam } from "../stores/trackedParam.js";

// Unified parameter enumeration (URL query, Cookie, x-www-form-urlencoded body)
// Set track=false to avoid paramStore mutations (e.g., header-only scans)
export function enumerateRequestParameters(requestOrSpec: any, sdk: any, responseCode?: number, track: boolean = true): RequestParameter[] {
  const spec = typeof requestOrSpec?.toSpec === 'function' ? requestOrSpec.toSpec() : requestOrSpec;
  if (!spec) return [];
  const params: RequestParameter[] = [];
  const endpoint = buildEndpoint(spec);
  const respCode = typeof responseCode === 'number' ? responseCode : 0;
  const store = reqParamsStore.get();

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
      push({ key, value, source: 'URL', method: spec.getMethod?.() || 'GET', code: respCode });
    }
  }

  // Cookies
  const cookiesHeader = spec.getHeader?.('Cookie')?.join('; ') ?? '';
  if (cookiesHeader) {
    for (const cookie of cookiesHeader.split(';')) {
      const eq = cookie.indexOf('='); if (eq === -1) continue;
      const key = cookie.slice(0, eq).trim(); const value = cookie.slice(eq + 1).trim();
      push({ key, value, source: 'Cookie', method: spec.getMethod?.() || 'GET', code: respCode });
    }
  }

  // Body (x-www-form-urlencoded only)
  if (spec.getMethod?.() === 'POST' && spec.getBody?.()) {
    const bodyObj = spec.getBody(); const ct = spec.getHeader?.('Content-Type');
    if (ct && ct[0]?.includes('application/x-www-form-urlencoded')) {
      for (const pair of bodyObj.toText().split('&')) {
        if (!pair) continue; const eq = pair.indexOf('='); if (eq === -1) continue;
        const key = pair.slice(0, eq).trim(); const value = pair.slice(eq + 1);
        push({ key, value, source: 'Body', method: spec.getMethod?.() || 'POST', code: respCode });
      }
    }
  }

  if (params.length === 0) sdk?.console?.log?.('[Reflector++] No (new) parameters found');
  return params;
}
