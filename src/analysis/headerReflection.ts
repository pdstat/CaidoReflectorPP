import { RequestParameter, AnalyzedReflectedParameter as BaseReflectedParameter } from "../core/types.js";
import { scoreFinding } from "./scoring.js";
import { enumerateRequestParameters } from "../utils/params.js";
import { parseQueryString, queryToString } from "../utils/query.js";

type ReflectedParameter = BaseReflectedParameter;

export async function confirmHeaderReflection(
  originalRequest: any,
  param: RequestParameter,
  headerNames: string[],
  sdk: any
): Promise<string[]> {
  const CANARY = `_HDR_CANARY_${Math.random().toString(36).slice(2, 10)}`;
  try {
    const requestSpec = originalRequest.toSpec();
    if (param.source === "URL") {
      const queryObj = parseQueryString(requestSpec.getQuery() || "");
      queryObj[param.key] = CANARY;
      requestSpec.setQuery(queryToString(queryObj));
    } else if (param.source.toLowerCase() === "body" && requestSpec.getBody()) {
      const bodyText = requestSpec.getBody()?.toText();
      if (bodyText) {
        // Best effort: treat as form-urlencoded (header reflection confirmation currently limited)
        const bodyObj = parseQueryString(bodyText);
        bodyObj[param.key] = CANARY;
        requestSpec.setBody(queryToString(bodyObj));
      }
    }
    sdk.console.log(`[Reflector++] Sending header confirmation request for parameter "${param.key}" with canary ${CANARY}`);
    const result = await sdk.requests.send(requestSpec);
    const confirmed: string[] = [];
    try {
      const newHeaders: Record<string, string | string[]> = (result.response as any).getHeaders ? (result.response as any).getHeaders() : {};
      for (const h of headerNames) {
        const v = newHeaders[h];
        const values = Array.isArray(v) ? v : [v];
        if (values.some(val => typeof val === "string" && val.includes(CANARY))) confirmed.push(h);
      }
    } catch (e) {
      sdk.console.log(`[Reflector++] Error reading headers for confirmation: ${e}`);
    }
    return confirmed;
  } catch (e) {
    sdk.console.log(`[Reflector++] Error confirming header reflection: ${e}`);
    return [];
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
    const confirmedHeaders = await confirmHeaderReflection(request, param, potential, sdk);
    if (confirmedHeaders.length > 0) {
      const syntheticMatches: Array<[number, number]> = confirmedHeaders.map((_, i) => [i, i]);
      const { confidence, severity, total } = scoreFinding({
        confirmed: true,
        allowedChars: [],
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
        certainty: total,
        confidence,
        severity,
        score: total
      });
    }
  }
  return confirmed;
}
