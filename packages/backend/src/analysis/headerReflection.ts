import { RequestParameter, AnalyzedReflectedParameter as BaseReflectedParameter } from "../core/types.js";
import { scoreFinding } from "./scoring.js";
import { enumerateRequestParameters } from "../utils/params.js";
import { sendProbe } from "./bodyReflection/probes.js";
import { ResponseHeaderPayloadGenerator } from "../payload/responseHeaderPayloadGenerator.ts";

type ReflectedParameter = BaseReflectedParameter;

export async function confirmHeaderReflection(
  originalRequest: any,
  param: RequestParameter,
  headerNames: string[],
  sdk: any
): Promise<{ confirmed: string[]; allowedChars: string[]; crlf: boolean; }> {
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
    try {
      const newHeaders: Record<string, string | string[]> = (result.response as any).getHeaders ? (result.response as any).getHeaders() : {};
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
      sdk.console.log(`[Reflector++] Error reading headers for confirmation: ${e}`);
    }
    return { confirmed, allowedChars, crlf };
  } catch (e) {
    sdk.console.log(`[Reflector++] Error confirming header reflection: ${e}`);
    return { confirmed: [], allowedChars: [], crlf: false };
  }
}

export async function checkHeaderReflections(request: any, response: any, sdk: any): Promise<ReflectedParameter[]> {
  const params = enumerateRequestParameters(request, sdk, response.getCode?.() ?? (response.getCode ? response.getCode() : 0), false);
  const confirmed: ReflectedParameter[] = [];
  if (params.length === 0) return confirmed;

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
    for (const [name, joined] of hdrsJoinedLower.entries()) if (joined.includes(needle)) potential.push(name);
    if (potential.length === 0) continue;
    const { confirmed: confirmedHeaders, allowedChars, crlf } = await confirmHeaderReflection(request, param, potential, sdk);
    if (confirmedHeaders.length > 0) {
      const syntheticMatches: Array<[number, number]> = confirmedHeaders.map((_, i) => [i, i]);
      const { confidence, severity, total } = scoreFinding({
        confirmed: true,
        allowedChars: allowedChars,
        context: "Response Header",
        header: true,
        headerNames: confirmedHeaders,
        matchCount: confirmedHeaders.length
      });
      confirmed.push({
        name: param.key,
        matches: syntheticMatches,
        context: "Response Header",
        source: param.source,
        headers: confirmedHeaders,
        aggressive: allowedChars.length ? allowedChars : undefined,
        certainty: total,
        confidence,
        severity,
        score: total
      });
    }
  }
  return confirmed;
}
