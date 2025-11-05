// Avoid direct typed import (Caido SDK d.ts is not a module under NodeNext); use loose any typing.
type SDK = any; type HttpInput = any;
import { AnalyzedReflectedParameter as BaseReflectedParameter } from "../../core/types.js";
import { findMatches, computeKeywordCounts } from "../../utils/text.js";
import { buildEndpoint } from "../../utils/http.js";
import { enumerateRequestParameters } from "../../utils/params.js";
import { KEY_WORDS } from "../../core/constants.js";
import { scoreFinding } from "../scoring.js";
import ResponseBodyPayloadGenerator from "../../payload/responseBodyPayloadGenerator.ts";
import { getTags } from "./context.js";
import { modifyAmbiguousParameters } from "./probes.js"; // compiled extension form
import { errorParamsStore } from "../../stores/errorStore.js";
import { runProbes } from "./probeRunner.js";
import { resolveBestContext } from "./contextResolution.js";
import { detectEncodedOnly } from "./encodedSignalDetection.js";

interface ReflectedParameter extends BaseReflectedParameter { confidence?: number; severity?: number; score?: number; }


export async function checkBodyReflections(input: HttpInput, sdk: SDK): Promise<ReflectedParameter[]> {
  const { request, response } = input;
  if (!request || !response) {
    sdk.console.log("[Reflector++] Skipping scan - request or response is missing");
    return [];
  }

  sdk.console.log("[Reflector++] Checking parameters for reflection (payload-based)...");
  const bodyText = response.getBody()?.toText() || "";
  const tags = getTags(bodyText);
  const payloadGenerator = new ResponseBodyPayloadGenerator(bodyText);
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

    let baselineMatches = findMatches(bodyText, param.value, sdk);
    if (baselineMatches.length === 0) {
      if (detectEncodedOnly(sdk, input, param.key, param.source, param.value, bodyText)) {
        // only encoded signal, skip literal processing
      }
      continue; // strict: no literal echo
    }

    sdk.console.log(`[Reflector++] Found ${baselineMatches.length} baseline reflection(s) for "${param.key}"`);
    const contextInfo = payloadGenerator.generate(sdk as any, param.value);
    let bestContext = resolveBestContext(baselineMatches, bodyText, tags, contextInfo);

    const { confirmed, successfulChars: probeChars, bestContext: resolvedCtx, probeWasStable } = await runProbes(sdk, request, param, contextInfo, baselineMatches, baselineCode, baselineSig, bodyText, KEY_WORDS, bestContext);
    if (confirmed) {
      const allowedChars = Array.from(probeChars);
      const { confidence, severity, total } = scoreFinding({ confirmed, allowedChars, context: resolvedCtx, header: false, matchCount: baselineMatches.length, bodyLength: bodyText.length, stableProbe: probeWasStable });
      reflectedParameters.push({ name: param.key, matches: baselineMatches, context: resolvedCtx, aggressive: allowedChars.length ? allowedChars : undefined, source: param.source, certainty: total, confidence, severity, score: total });
    }
  }
  return reflectedParameters;
}
