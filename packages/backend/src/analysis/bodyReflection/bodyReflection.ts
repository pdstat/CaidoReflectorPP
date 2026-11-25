// Avoid direct typed import (Caido SDK d.ts is not a module under NodeNext); use loose any typing.
type SDK = any; type HttpInput = any;
import { AnalyzedReflectedParameter } from "../../core/types.js";
import { findMatches } from "../../utils/text.js";
import { buildEndpoint, isJsContentType } from "../../utils/http.js";
import { enumerateRequestParameters } from "../../utils/params.js";
import { classifySeverity } from "../scoring.js";
import { toCanonical, CONTEXT } from "../contextMap.js";
import JsonResponseBodyPayloadGenerator from "../../payload/jsonResponseBodyPayloadGenerator.ts";
import JsResponseBodyPayloadGenerator from "../../payload/jsResponseBodyPayloadGenerator.ts";
import ResponseBodyPayloadGenerator from "../../payload/responseBodyPayloadGenerator.ts";
import { getTags } from "./context.js";
import { modifyAmbiguousParameters } from "./probes.js";
import { errorParamsStore } from "../../stores/errorStore.js";
import { reqParamsStore } from "../../stores/paramStore.js";
import { UNCONFIRMED_VALUE_CAP } from "../../core/constants.js";
import { runProbes, runCountProbe } from "./probeRunner.js";
import { resolveBestContext } from "./contextResolution.js";
import { detectEncodedOnly } from "./encodedSignalDetection.js";

type ReflectedParameter = AnalyzedReflectedParameter;

// Contexts where a reflection is only exploitable if a breakout char survives. In these,
// a 'low' severity means no breakout was achieved, so the finding is not confirmed. Code
// contexts (js/eventHandler/jsUri/importMap) are exploitable by the reflection itself and
// are excluded; JSON string contexts are handled inside runProbes.
const NEEDS_BREAKOUT = new Set<string>([
  CONTEXT.HTML, CONTEXT.HTML_COMMENT, CONTEXT.HTML_BASE_INJECTION,
  CONTEXT.SVG_CONTEXT, CONTEXT.MATH_CONTEXT, CONTEXT.RAWTEXT_ELEMENT,
  CONTEXT.ATTRIBUTE, CONTEXT.ATTRIBUTE_IN_QUOTE, CONTEXT.ATTRIBUTE_ESCAPED,
  CONTEXT.CSS, CONTEXT.CSS_IN_QUOTE,
]);


interface BodyScan {
  sdk: SDK;
  input: HttpInput;
  request: any;
  bodyText: string;
  tags: ReturnType<typeof getTags>;
  payloadGenerator: { generate: (sdk: any, value: string) => any };
  baselineCode: number;
  endpoint: string;
  isJsResponse: boolean;
  isNonRenderedBody: boolean;
  logUnconfirmed: boolean;
}

export async function checkBodyReflections(input: HttpInput, sdk: SDK, logUnconfirmed = false): Promise<ReflectedParameter[]> {
  const { request, response } = input;
  if (!request || !response) {
    sdk.console.log("[Reflector++] Skipping scan - request or response is missing");
    return [];
  }

  sdk.console.log("[Reflector++] Checking parameters for reflection (payload-based)...");
  const bodyText = response.getBody()?.toText() || "";
  const rawContentType = response.getHeader?.("Content-Type");
  const normalizedType = Array.isArray(rawContentType)
    ? rawContentType.find((v) => v && v.trim() !== "")
    : typeof rawContentType === "string" && rawContentType.trim() !== "" ? rawContentType : undefined;
  const contentTypeBase = normalizedType?.toLowerCase().split(";")[0];
  const isJsonResponse = contentTypeBase === "application/json";
  // Standalone JS response: the whole body is script. Classify by JS string state and
  // score as JS execution (minus the HTML-tag-escape criticals an external script can't reach).
  const isJsResponse = isJsContentType(rawContentType);
  const payloadGenerator = isJsonResponse
    ? new JsonResponseBodyPayloadGenerator(bodyText)
    : isJsResponse
    ? new JsResponseBodyPayloadGenerator(bodyText)
    : new ResponseBodyPayloadGenerator(bodyText);
  const endpoint = buildEndpoint(input.request);

  let requestParameters = enumerateRequestParameters(request.toSpec(), sdk, response.getCode());
  // If the scan is aborted (throttled host, deadline), these params were never fully
  // tested: release them so the next request carrying them is probed again. Snapshot
  // first -- modifyAmbiguousParameters rewrites short values in place.
  const enumerated = requestParameters.map((p) => ({ ...p }));
  sdk.scan?.onAbort.push(() => reqParamsStore.get().release(endpoint, enumerated as any));
  [input, requestParameters] = await modifyAmbiguousParameters(sdk as any, input, requestParameters);

  const scan: BodyScan = {
    sdk, input, request, bodyText, tags: getTags(bodyText), payloadGenerator, endpoint,
    baselineCode: response.getCode(),
    isJsResponse,
    // Analyzed for reflections but NOT rendered as HTML by the browser (e.g. Next.js RSC
    // flight payloads), so any tag-injection there is not executable -- scored conservatively.
    isNonRenderedBody: contentTypeBase === "text/x-component",
    logUnconfirmed,
  };
  // Params probe concurrently; the probe limiter caps how many requests are in flight.
  const results = await Promise.all(requestParameters.map((param) => checkParameter(scan, param)));
  return results.filter((r): r is ReflectedParameter => r !== undefined);
}

async function checkParameter(scan: BodyScan, param: any): Promise<ReflectedParameter | undefined> {
  const { sdk, request, bodyText, baselineCode, endpoint } = scan;
  if (!param.value) return undefined;
  if (errorParamsStore.get().paramErrored(endpoint, param)) {
    sdk.console.log(`[Reflector++] Skipping parameter "${param.key}" due to previous error tracking`);
    return undefined;
  }
  sdk.console.log(`[Reflector++] Checking parameter "${param.key}" (source: ${param.source}, value: "${param.value}")`);

  const baselineMatches = findMatches(bodyText, param.value, false, sdk);
  if (baselineMatches.length === 0) {
    detectEncodedOnly(sdk, scan.input, param.key, param.source, param.value, bodyText);
    return undefined; // strict: no literal echo
  }

  sdk.console.log(`[Reflector++] Found ${baselineMatches.length} baseline reflection(s) for "${param.key}"`);
  const contextInfo = scan.payloadGenerator.generate(sdk as any, param.value);
  const bestContext = resolveBestContext(baselineMatches, bodyText, scan.tags, contextInfo);
  const reflectedIn: string[] = contextInfo?.context?.length > 0 ? contextInfo.context : [bestContext];
  // Reflected without confirming for several values in these same contexts already:
  // a rotating value (token, nonce) that is safely encoded. Not worth re-probing.
  if (reqParamsStore.get().capped(endpoint, param, reflectedIn)) return undefined;

  const { confirmed, reflected, successfulChars: probeChars, bestContext: resolvedCtx, firstBatchCount, batchFailed } = await runProbes(sdk, request, param, contextInfo, bestContext);
  const unconfirmed = (): undefined => noteUnconfirmed(scan, param, reflectedIn, batchFailed);

  let pathCountResult: Awaited<ReturnType<typeof runCountProbe>>;
  if (param.source === 'Path' && (confirmed || reflected)) {
    pathCountResult = await runCountProbe(sdk, request, param);
    if (pathCountResult && pathCountResult.matches.length === 0) {
      sdk.console.log(`[Reflector++] Path segment "${param.key}" — count probe found 0 reflections, suppressing false positive (baseline had ${baselineMatches.length} natural word matches)`);
      return unconfirmed();
    }
    if (pathCountResult && pathCountResult.code !== baselineCode) {
      sdk.console.log(`[Reflector++] Path segment "${param.key}" — count probe returned ${pathCountResult.code} (baseline ${baselineCode}), suppressing error-page reflection`);
      return unconfirmed();
    }
  }

  const allowedChars = confirmed ? Array.from(probeChars) : [];
  const grade = confirmed
    ? gradeConfirmed(scan, resolvedCtx, allowedChars)
    : { isConfirmed: false, severity: 'info' as const };
  if (grade.isConfirmed) {
    const otherContexts = otherContextsOf(contextInfo, resolvedCtx);
    let finalMatches = baselineMatches;
    let finalValue = param.value;
    if (param.source === 'Path' && pathCountResult) {
      finalMatches = pathCountResult.matches;
      finalValue = pathCountResult.value;
    } else {
      // The first probe batch carries a unique leading marker, so its count stands in
      // for a separate count probe -- unless the batch changed the response status (e.g. a
      // quote triggered an error page) so its count is unrepresentative, or the param is a
      // Path segment, whose count probe also does false-positive suppression.
      const useFirstBatch = param.source !== 'Path' && firstBatchCount?.code === baselineCode;
      const countResult = useFirstBatch && firstBatchCount
        ? firstBatchCount
        : await runCountProbe(sdk, request, param);
      if (countResult && countResult.matches.length >= baselineMatches.length) {
        finalMatches = countResult.matches;
        finalValue = countResult.value;
      }
    }
    // An aborted scan creates no finding, so it must not dedupe the param either.
    if (sdk.scan?.abortReason) return undefined;
    // Reflection confirmed here: dedupe this param by name from now on, so
    // later values are not re-probed now that a finding exists for it.
    reqParamsStore.get().markConfirmed(endpoint, param as any);
    return { name: param.key, matches: finalMatches, context: resolvedCtx, aggressive: allowedChars.length ? allowedChars : undefined, source: param.source, value: finalValue, confirmed: true, severity: grade.severity, otherContexts, isJsResponse: scan.isJsResponse };
  }
  unconfirmed();
  if (scan.logUnconfirmed && reflected) {
    sdk.console.log(`[Reflector++] Logging unconfirmed reflection for "${param.key}" (probe markers reflected, no dangerous chars confirmed)`);
    return { name: param.key, matches: baselineMatches, context: resolvedCtx, aggressive: undefined, source: param.source, value: param.value, confirmed: false, severity: 'info' };
  }
  return undefined;
}

// Counts a value whose probes completed without a confirmed reflection towards the
// param's cap. Incomplete results (a failed batch, an aborted scan) do not count.
function noteUnconfirmed(
  scan: BodyScan, param: any, reflectedIn: string[], batchFailed: boolean
): undefined {
  if (batchFailed || scan.sdk.scan?.abortReason) return undefined;
  if (reqParamsStore.get().recordUnconfirmed(scan.endpoint, param, reflectedIn)) {
    scan.sdk.console.log(`[Reflector++] "${param.key}" on ${scan.endpoint} capped after `
      + `${UNCONFIRMED_VALUE_CAP} unconfirmed values in {${reflectedIn.join(', ')}}; `
      + `not probing new values there until reload`);
  }
  return undefined;
}

// Severity for a probe-confirmed reflection, and whether it stays confirmed.
function gradeConfirmed(
  scan: BodyScan, resolvedCtx: string, allowedChars: string[]
): { isConfirmed: boolean; severity: ReturnType<typeof classifySeverity> } {
  const { isJsResponse, isNonRenderedBody, baselineCode } = scan;
  let isConfirmed = true;
  let severity = classifySeverity({ confirmed: true, allowedChars, context: resolvedCtx, header: false, isJsResponse });
  // Over-rate corrections: genuine reflections that are not executable as-is.
  // A 3xx body is not rendered (browsers follow the redirect) and an RSC flight body
  // is not HTML-rendered -- cap both at low. <template> content is inert until a script
  // clones it -- cap tag injection there at medium.
  if ((isNonRenderedBody || (baselineCode >= 300 && baselineCode < 400)) && severity !== 'info') {
    severity = 'low';
  } else if (/template/i.test(resolvedCtx) && (severity === 'high' || severity === 'critical')) {
    severity = 'medium';
  }
  // confirmed-gate: in a context that needs a breakout char to be dangerous, demote to
  // unconfirmed when no breakout was achieved -- i.e. a 'low' result (reuses
  // classifySeverity's per-context logic, catching inert survivors like a non-enclosing
  // quote or "/"/";" in HTML text) OR no non-empty char survived at all (catches
  // endpoints whose context scores medium by default, e.g. an unquoted attribute that
  // URL-encodes every breakout char).
  const gateCanonical = toCanonical(resolvedCtx);
  const noBreakoutChar = !allowedChars.some(c => c !== "");
  if ((severity === 'low' || noBreakoutChar) && gateCanonical && NEEDS_BREAKOUT.has(gateCanonical)) {
    isConfirmed = false;
  }
  // JS-response confirmed-breakout gate: a JS context is executable without a breakout
  // for an inline <script>, but a standalone JS response reflects constantly on ad
  // traffic (ids, macros). Require a real survivor there -- an inert reflection (only a
  // non-breakout char, scored 'low') or none at all is suppressed, not reported.
  if (isJsResponse && (severity === 'low' || noBreakoutChar)) {
    isConfirmed = false;
  }
  return { isConfirmed, severity };
}

function otherContextsOf(contextInfo: any, resolvedCtx: string): Record<string, number> | undefined {
  const otherContexts: Record<string, number> = {};
  if (contextInfo?.context) {
    const primaryCanonical = toCanonical(resolvedCtx);
    for (const c of contextInfo.context) {
      const cc = toCanonical(c);
      if (cc && cc !== primaryCanonical) {
        otherContexts[cc] = (otherContexts[cc] ?? 0) + 1;
      }
    }
  }
  return Object.keys(otherContexts).length > 0 ? otherContexts : undefined;
}
