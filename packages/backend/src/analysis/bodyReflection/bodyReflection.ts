// Avoid direct typed import (Caido SDK d.ts is not a module under NodeNext); use loose any typing.
type SDK = any; type HttpInput = any;
import { AnalyzedReflectedParameter } from "../../core/types.js";
import { findMatches, computeKeywordCounts } from "../../utils/text.js";
import { buildEndpoint } from "../../utils/http.js";
import { enumerateRequestParameters } from "../../utils/params.js";
import { KEY_WORDS } from "../../core/constants.js";
import { classifySeverity } from "../scoring.js";
import JsonResponseBodyPayloadGenerator from "../../payload/jsonResponseBodyPayloadGenerator.ts";
import ResponseBodyPayloadGenerator from "../../payload/responseBodyPayloadGenerator.ts";
import { getTags } from "./context.js";
import { modifyAmbiguousParameters } from "./probes.js";
import { errorParamsStore } from "../../stores/errorStore.js";
import { runProbes } from "./probeRunner.js";
import { resolveBestContext } from "./contextResolution.js";
import { detectEncodedOnly } from "./encodedSignalDetection.js";

type ReflectedParameter = AnalyzedReflectedParameter;


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
  const isJsonResponse = normalizedType?.toLowerCase().split(";")[0] === "application/json";
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
    if (confirmed) {
      const allowedChars = Array.from(probeChars);
      const severity = classifySeverity({ confirmed, allowedChars, context: resolvedCtx, header: false });
      const otherContexts: Record<string, number> = {};
      if (contextInfo?.context) {
        for (const c of contextInfo.context) {
          if (c !== resolvedCtx) otherContexts[c] = baselineMatches.length;
        }
      }
      const hasOther = Object.keys(otherContexts).length > 0;
      reflectedParameters.push({ name: param.key, matches: baselineMatches, context: resolvedCtx, aggressive: allowedChars.length ? allowedChars : undefined, source: param.source, value: param.value, confirmed: true, severity, otherContexts: hasOther ? otherContexts : undefined });
    } else if (logUnconfirmed && reflected) {
      sdk.console.log(`[Reflector++] Logging unconfirmed reflection for "${param.key}" (probe markers reflected, no dangerous chars confirmed)`);
      reflectedParameters.push({ name: param.key, matches: baselineMatches, context: resolvedCtx, aggressive: undefined, source: param.source, value: param.value, confirmed: false, severity: 'info' });
    }
  }
  return reflectedParameters;
}
