// Avoid direct typed import (Caido SDK d.ts is not a module under NodeNext); use loose any typing.
type SDK = any; type HttpInput = any;
import { AnalyzedReflectedParameter } from "../../core/types.js";
import { findMatches, computeKeywordCounts } from "../../utils/text.js";
import { buildEndpoint } from "../../utils/http.js";
import { enumerateRequestParameters } from "../../utils/params.js";
import { KEY_WORDS } from "../../core/constants.js";
import { classifySeverity } from "../scoring.js";
import { toCanonical, CONTEXT } from "../contextMap.js";
import JsonResponseBodyPayloadGenerator from "../../payload/jsonResponseBodyPayloadGenerator.ts";
import ResponseBodyPayloadGenerator from "../../payload/responseBodyPayloadGenerator.ts";
import { getTags } from "./context.js";
import { modifyAmbiguousParameters } from "./probes.js";
import { errorParamsStore } from "../../stores/errorStore.js";
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


export async function checkBodyReflections(input: HttpInput, sdk: SDK, logUnconfirmed = false): Promise<ReflectedParameter[]> {
  const { request, response } = input;
  if (!request || !response) {
    sdk.console.log("[Reflector++] Skipping scan - request or response is missing");
    return [];
  }

  sdk.console.log("[Reflector++] Checking parameters for reflection (payload-based)...");
  const bodyText = response.getBody()?.toText() || "";
  const tags = getTags(bodyText);
  const rawContentType = response.getHeader?.("Content-Type");
  const normalizedType = Array.isArray(rawContentType)
    ? rawContentType.find((v) => v && v.trim() !== "")
    : typeof rawContentType === "string" && rawContentType.trim() !== "" ? rawContentType : undefined;
  const contentTypeBase = normalizedType?.toLowerCase().split(";")[0];
  const isJsonResponse = contentTypeBase === "application/json";
  // Analyzed for reflections but NOT rendered as HTML by the browser (e.g. Next.js RSC
  // flight payloads), so any tag-injection there is not executable -- scored conservatively.
  const isNonRenderedBody = contentTypeBase === "text/x-component";
  const payloadGenerator = isJsonResponse
    ? new JsonResponseBodyPayloadGenerator(bodyText)
    : new ResponseBodyPayloadGenerator(bodyText);
  const baselineCode = response.getCode();
  const baselineBody = bodyText;
  const baselineSig = computeKeywordCounts(baselineBody, KEY_WORDS).join(",");
  const endpoint = buildEndpoint(input.request);

  let requestParameters = enumerateRequestParameters(request.toSpec(), sdk, response.getCode());
  [input, requestParameters] = await modifyAmbiguousParameters(sdk as any, input, requestParameters);

  const reflectedParameters: ReflectedParameter[] = [];
  for (const param of requestParameters) {
    if (!param.value) continue;
    const errorParamStore = errorParamsStore.get();
    if (errorParamStore.paramErrored(endpoint, param)) {
      sdk.console.log(`[Reflector++] Skipping parameter "${param.key}" due to previous error tracking`);
      continue;
    }
    sdk.console.log('-------');
    sdk.console.log(`[Reflector++] Checking parameter "${param.key}" (source: ${param.source}, value: "${param.value}")`);

    let baselineMatches = findMatches(bodyText, param.value, false, sdk);
    if (baselineMatches.length === 0) {
      if (detectEncodedOnly(sdk, input, param.key, param.source, param.value, bodyText)) {
        // only encoded signal, skip literal processing
      }
      continue; // strict: no literal echo
    }

    sdk.console.log(`[Reflector++] Found ${baselineMatches.length} baseline reflection(s) for "${param.key}"`);
    const contextInfo = payloadGenerator.generate(sdk as any, param.value);
    let bestContext = resolveBestContext(baselineMatches, bodyText, tags, contextInfo);

    const { confirmed, reflected, successfulChars: probeChars, bestContext: resolvedCtx } = await runProbes(sdk, request, param, contextInfo, baselineMatches, baselineCode, baselineSig, bodyText, KEY_WORDS, bestContext);

    let pathCountResult: Awaited<ReturnType<typeof runCountProbe>>;
    if (param.source === 'Path' && (confirmed || reflected)) {
      pathCountResult = await runCountProbe(sdk, request, param);
      if (pathCountResult && pathCountResult.matches.length === 0) {
        sdk.console.log(`[Reflector++] Path segment "${param.key}" — count probe found 0 reflections, suppressing false positive (baseline had ${baselineMatches.length} natural word matches)`);
        continue;
      }
      if (pathCountResult && pathCountResult.code !== baselineCode) {
        sdk.console.log(`[Reflector++] Path segment "${param.key}" — count probe returned ${pathCountResult.code} (baseline ${baselineCode}), suppressing error-page reflection`);
        continue;
      }
    }

    let isConfirmed = confirmed;
    let severity: ReturnType<typeof classifySeverity> = 'info';
    let allowedChars: string[] = [];
    if (isConfirmed) {
      allowedChars = Array.from(probeChars);
      severity = classifySeverity({ confirmed: true, allowedChars, context: resolvedCtx, header: false });
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
    }
    if (isConfirmed) {
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
      const hasOther = Object.keys(otherContexts).length > 0;
      let finalMatches = baselineMatches;
      let finalValue = param.value;
      if (param.source === 'Path' && pathCountResult) {
        finalMatches = pathCountResult.matches;
        finalValue = pathCountResult.value;
      } else {
        const countResult = await runCountProbe(sdk, request, param);
        if (countResult && countResult.matches.length >= baselineMatches.length) {
          finalMatches = countResult.matches;
          finalValue = countResult.value;
        }
      }
      reflectedParameters.push({ name: param.key, matches: finalMatches, context: resolvedCtx, aggressive: allowedChars.length ? allowedChars : undefined, source: param.source, value: finalValue, confirmed: true, severity, otherContexts: hasOther ? otherContexts : undefined });
    } else if (logUnconfirmed && reflected) {
      sdk.console.log(`[Reflector++] Logging unconfirmed reflection for "${param.key}" (probe markers reflected, no dangerous chars confirmed)`);
      reflectedParameters.push({ name: param.key, matches: baselineMatches, context: resolvedCtx, aggressive: undefined, source: param.source, value: param.value, confirmed: false, severity: 'info' });
    }
  }
  return reflectedParameters;
}
