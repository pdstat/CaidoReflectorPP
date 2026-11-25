import { RequestParameter, AnalyzedReflectedParameter } from "../core/types.js";
import { classifySeverity } from "./scoring.js";
import { enumerateRequestParameters } from "../utils/params.js";
import { sendProbe } from "./bodyReflection/probes.js";
import { ResponseHeaderPayloadGenerator } from "../payload/responseHeaderPayloadGenerator.ts";
import { detectRedirectPosition } from "./redirectAnalysis.js";
import { buildEndpoint } from "../utils/http.js";
import { headerParamsStore } from "../stores/paramStore.js";
import { UNCONFIRMED_VALUE_CAP } from "../core/constants.js";

type ReflectedParameter = AnalyzedReflectedParameter;

const SKIP_RESPONSE_HEADERS = new Set([
  'x-cache-key',
  'x-vercel-cache-key',
  'x-nextjs-rewritten-path',
  'x-nextjs-page',
  'x-nextjs-prerender',
  'x-nextjs-stale-time',
  'x-matched-path',
  'x-invoke-path',
  'x-original-url',
  'x-rewrite-url',
  'x-request-url',
  'content-location',
  'x-request-id',
  'x-trace-id',
  'x-correlation-id',
  'x-amzn-requestid',
  'x-amzn-trace-id',
  'x-vercel-id',
  'x-powered-by',
  'server',
  'date',
  'etag',
  'x-cache',
  'x-cache-status',
  'x-served-by',
  'cf-ray',
  'cf-cache-status',
  'x-runtime',
]);

export async function confirmHeaderReflection(
  originalRequest: any,
  param: RequestParameter,
  headerNames: string[],
  sdk: any
): Promise<{ confirmed: string[]; allowedChars: string[]; crlf: boolean; canary: string; probeHeaders: Record<string, string | string[]>; failed: boolean; }> {
  const CANARY = `_HDR_CANARY_${Math.random().toString(36).slice(2, 10)}`;
  try {
    const requestSpec = originalRequest.toSpec();
    // Build header probing plan (context-aware chars)
    const plan = ResponseHeaderPayloadGenerator.buildPlan(headerNames);
    const combinedValue = CANARY + plan.injectedValue; // Ensure canary present first for legacy confirmation
    const probeParams: RequestParameter[] = [
      {
        key: param.key,
        value: combinedValue,
        source: param.source,
        method: param.method,
        code: param.code
      }
    ];
    sdk.console.log(`[Reflector++] Sending header confirmation request for parameter "${param.key}" with canary ${CANARY} and ${plan.markers.length} header probes`);
    const result = await sendProbe(sdk, requestSpec, probeParams);
    const confirmed: string[] = [];
    let allowedChars: string[] = [];
    let crlf = false;
    let probeHeaders: Record<string, string | string[]> = {};
    let failed = false;
    try {
      const newHeaders: Record<string, string | string[]> = (result.response as any).getHeaders ? (result.response as any).getHeaders() : {};
      probeHeaders = newHeaders;
      const canaryLower = CANARY.toLowerCase();
      for (const h of headerNames) {
        const v = newHeaders[h];
        const values = Array.isArray(v) ? v : [v];
        if (values.some(val => typeof val === "string" && val.toLowerCase().includes(canaryLower))) confirmed.push(h);
      }
      if (confirmed.length) {
        const detection = ResponseHeaderPayloadGenerator.detect(newHeaders, plan.markers);
        allowedChars = detection.allowedChars;
        crlf = detection.crlfInjection;
      }
    } catch (e) {
      failed = true;
      sdk.console.log(`[Reflector++] Error reading headers for confirmation: ${e}`);
    }
    return { confirmed, allowedChars, crlf, canary: CANARY, probeHeaders, failed };
  } catch (e) {
    sdk.console.log(`[Reflector++] Error confirming header reflection: ${e}`);
    return { confirmed: [], allowedChars: [], crlf: false, canary: CANARY, probeHeaders: {}, failed: true };
  }
}

type HeaderTracking = { sdk: any; endpoint: string; probed: RequestParameter[] };

// Marks a completed header probe: the value is tested, and the param is either confirmed
// (deduped by name) or counted towards its unconfirmed-value cap for these headers.
function recordHeaderOutcome(
  track: HeaderTracking, param: RequestParameter, headerContexts: string[], isConfirmed: boolean
): void {
  const tested = headerParamsStore.get();
  track.probed.push(param);
  tested.addParam(track.endpoint, param);
  if (isConfirmed) {
    tested.markConfirmed(track.endpoint, param);
  } else if (tested.recordUnconfirmed(track.endpoint, param, headerContexts)) {
    track.sdk.console.log(`[Reflector++] "${param.key}" on ${track.endpoint} capped after `
      + `${UNCONFIRMED_VALUE_CAP} unconfirmed values in headers {${headerContexts.join(', ')}}; `
      + `not probing new values there until reload`);
  }
}

export async function checkHeaderReflections(request: any, response: any, sdk: any): Promise<ReflectedParameter[]> {
  const params = enumerateRequestParameters(request, sdk, response.getCode?.() ?? (response.getCode ? response.getCode() : 0), false);
  const confirmed: ReflectedParameter[] = [];
  if (params.length === 0) return confirmed;
  // Params probed here are deduped across requests; if this scan is later dropped they
  // are released so the next request retests them.
  const track: HeaderTracking = { sdk, endpoint: buildEndpoint(request), probed: [] };
  sdk.scan?.onAbort.push(() => headerParamsStore.get().release(track.endpoint, track.probed));

  const hdrsRaw: Record<string, string | string[]> = (response as any).getHeaders ? (response as any).getHeaders() : {};
  const hdrs = new Map<string, string[]>();
  for (const [k, v] of Object.entries(hdrsRaw)) {
    const arr = Array.isArray(v) ? v : [v];
    hdrs.set(k, arr.filter((s): s is string => typeof s === "string"));
  }
  const hdrsJoinedLower = new Map<string, string>();
  for (const [k, arr] of hdrs.entries()) hdrsJoinedLower.set(k, arr.join("\n").toLowerCase());

  for (const param of params) {
    if (!param.value) continue;
    const needle = param.value.toLowerCase();
    const potential: string[] = [];
    for (const [name, joined] of hdrsJoinedLower.entries()) {
      if (SKIP_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
      if (joined.includes(needle)) potential.push(name);
    }
    if (potential.length === 0) continue;
    const headerContexts = potential.map((h) => h.toLowerCase());
    const tested = headerParamsStore.get();
    if (tested.paramTested(track.endpoint, param) || tested.capped(track.endpoint, param, headerContexts)) continue;
    const { confirmed: confirmedHeaders, allowedChars, crlf, canary, probeHeaders, failed } = await confirmHeaderReflection(request, param, potential, sdk);
    if (failed || sdk.scan?.abortReason) continue;
    recordHeaderOutcome(track, param, headerContexts, confirmedHeaders.length > 0);
    if (confirmedHeaders.length > 0) {
      const syntheticMatches: Array<[number, number]> = confirmedHeaders.map((_, i) => [i, i]);
      const contextLabel = crlf ? "Response Splitting (CRLF)" : "Response Header";

      let redirectPosition;
      if (!crlf && param.value) {
        for (const h of confirmedHeaders) {
          const hLower = h.toLowerCase();
          if (hLower === 'location' || hLower === 'refresh') {
            // Classify position from where the unique canary actually reflected in the
            // probe response, not from a re-search of the original value. A short/common
            // value (e.g. "1") can collide with incidental content earlier in the redirect
            // URL (e.g. the "1" in host "1rx.io"), which would mis-read a trailing-query
            // reflection as a host/subdomain breakout and over-rate the severity.
            const probeVals = probeHeaders[h];
            const probeValue = Array.isArray(probeVals) ? probeVals[0] : probeVals;
            if (typeof probeValue === "string" && probeValue.toLowerCase().includes(canary.toLowerCase())) {
              redirectPosition = detectRedirectPosition(probeValue, canary, h);
            } else {
              const values = hdrs.get(h) ?? [];
              if (values.length > 0) {
                redirectPosition = detectRedirectPosition(values[0], param.value, h);
              }
            }
            break;
          }
        }
      }

      const allowCredentials = (hdrsJoinedLower.get('access-control-allow-credentials') ?? '').includes('true');
      const severity = classifySeverity({
        confirmed: true,
        allowedChars,
        context: contextLabel,
        header: !crlf,
        headerNames: confirmedHeaders,
        redirectPosition,
        allowCredentials
      });
      confirmed.push({
        name: param.key,
        matches: syntheticMatches,
        context: contextLabel,
        source: param.source,
        headers: confirmedHeaders,
        aggressive: allowedChars.length ? allowedChars : undefined,
        value: param.value,
        severity,
        confirmed: true,
        redirectPosition
      });
    }
  }
  return confirmed;
}
