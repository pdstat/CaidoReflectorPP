import { RequestParameter } from "../../core/types.js";
import { randomValue, computeKeywordCounts } from "../../utils/text.js";
import { buildEndpoint, passesContentTypeGating } from "../../utils/http.js";
import { errorParamsStore } from "../../stores/errorStore.js";
import { mutateParamValue } from "../../utils/query.js";
import { KEY_WORDS } from "../../core/constants.js";

// Lightweight SDK-ish type hints (avoid direct import to skirt type module issues)
interface SDKLike {
  console: { log: (msg: string) => void };
  requests: { send: (spec: any) => Promise<any> };
}

export const sendProbe = async (
  sdk: SDKLike,
  requestSpec: any,
  params: RequestParameter[]
) => {
  try {
    for (const param of params) mutateParamValue(requestSpec, param, param.value ?? "", sdk as any);
    sdk.console.log(`[Reflector++] Sending probe request...`);
    return await sdk.requests.send(requestSpec);
  } catch (e) {
    throw `sendProbe threw error: ${e}`;
  }
};


export const modifyAmbiguousParameters = async (
  sdk: SDKLike,
  input: any,
  params: RequestParameter[]
): Promise<[any, RequestParameter[]]> => {
  const ambIdx: number[] = [];
  for (let i = 0; i < params.length; i++) {
    const v = params[i].value || "";
    if (v.length <= 2) ambIdx.push(i); // COMMON_WORDS handled earlier; keep simple here
  }
  if (ambIdx.length === 0) return [input, params];

  const baselineBody = input.response.getBody()?.toText() || "";
  const baselineCode = input.response.getCode?.() ?? input.response.getCode?.() ?? 0;
  const baselineSig = computeKeywordCounts(baselineBody, KEY_WORDS);

  const isStableLikeBaseline = (probe: any): boolean => {
    const ctHeader = probe.response.getHeader("Content-Type");
    const nosniffHeader = probe.response.getHeader("X-Content-Type-Options");
    if (!passesContentTypeGating(ctHeader, nosniffHeader)) return false;
    const codeEqual = (probe.response.getCode?.() ?? 0) === baselineCode;
    if (!codeEqual) return false;
    const body = probe.response.getBody()?.toText() || "";
    const sig = computeKeywordCounts(body, KEY_WORDS);
    for (let i = 0; i < sig.length; i++) if (sig[i] !== baselineSig[i]) return false;
    return true;
  };

  const bulkParams: RequestParameter[] = params.map((p, idx) => ambIdx.includes(idx) ? { ...p, value: randomValue() } : p);

  try {
    sdk.console.log(`[Reflector++] Ambiguous params detected (${ambIdx.length}). Sending bulk stabilisation probe...`);
    const bulkProbe = await sendProbe(sdk, input.request.toSpec(), bulkParams);
    if (isStableLikeBaseline(bulkProbe)) {
      for (const i of ambIdx) params[i].value = bulkParams[i].value!;
      input = bulkProbe;
      sdk.console.log("[Reflector++] Bulk stabilisation successful; adopted randomised values for all ambiguous params.");
      return [input, params];
    }
    sdk.console.log("[Reflector++] Bulk stabilisation not stable; falling back to per-parameter refinement.");
  } catch (e) {
    sdk.console.log(`[Reflector++] Bulk stabilisation probe failed (${e}); falling back to per-parameter refinement.`);
  }

  const errStore = errorParamsStore.get();
  const endpoint = buildEndpoint(input.request);

  for (const i of ambIdx) {
    if (errStore.paramErrored(endpoint, params[i])) continue;
    const mutated = params.map((p, idx) => (idx === i ? { ...p, value: randomValue() } : p));
    try {
      const probe = await sendProbe(sdk, input.request.toSpec(), mutated);
      if (isStableLikeBaseline(probe)) {
        params[i].value = mutated[i].value!;
        input = probe;
        sdk.console.log(`[Reflector++] Stabilised ambiguous param "${params[i].key}" with randomised value.`);
      } else {
        errStore.addParam(endpoint, params[i]);
      }
    } catch (e) {
      errStore.addParam(endpoint, params[i]);
    }
  }
  return [input, params];
};
