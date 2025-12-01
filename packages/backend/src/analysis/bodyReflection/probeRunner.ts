// Probe execution logic extracted from bodyReflection.ts for clarity and testability.
// Handles batching, stability assessment, detection, and successful character harvesting.

type SDK = any;
import { randomValue, findMatches } from "../../utils/text.js";
import { mutateParamValue } from "../../utils/query.js";
import { passesContentTypeGating } from "../../utils/http.js";
import { allowedDetectionContextsFor, isLiteralContext } from "../../utils/contexts.js";
import JsonResponseBodyPayloadGenerator from "../../payload/jsonResponseBodyPayloadGenerator.ts";
import ResponseBodyPayloadGenerator from "../../payload/responseBodyPayloadGenerator.ts";

export interface ProbeResult {
    confirmed: boolean;
    successfulChars: Set<string>;
    bestContext: string;
    probeWasStable: boolean;
}

export async function runProbes(
    sdk: SDK,
    request: any,
    param: any,
    contextInfo: any,
    baselineMatches: Array<[number, number]>,
    baselineCode: number,
    baselineSig: string,
    bodyText: string,
    KEY_WORDS_LOCAL: string[],
    initialBestContext: string
): Promise<ProbeResult> {
    const successfulChars = new Set<string>();
    let confirmed = false; let probeWasStable = false; let bestContext = initialBestContext;
    if (!contextInfo || !Array.isArray(contextInfo.payload) || contextInfo.payload.length === 0) {
        return { confirmed: false, successfulChars, bestContext, probeWasStable };
    }
    const BATCH = 8;
    for (let i = 0; i < contextInfo.payload.length; i += BATCH) {
        const batch = contextInfo.payload.slice(i, i + BATCH);
        const markers = batch.map((ch: string) => ({ ch, pre: randomValue(5), suf: randomValue(5) }));
        const injected = markers.map((m: { ch: string; pre: string; suf: string }) => m.pre + encodeURIComponent(m.ch) + m.suf).join("");
        const probeSpec: any = request.toSpec();
        mutateParamValue(probeSpec, param, injected, sdk as any);
        sdk.console.log(`[Reflector++] Probing ${param.key} with batch [${batch.join(', ')}]`);
        try {
            const probe = await (sdk as any).requests.send(probeSpec);
            const ctHeader = probe.response.getHeader('Content-Type');
            const nosniffHeader = probe.response.getHeader('X-Content-Type-Options');
            if (!passesContentTypeGating(ctHeader, nosniffHeader)) {
                sdk.console.log('[Reflector++] Probe response content-type gating failed, skipping batch');
                continue;
            }
            if (probe.response.getCode?.() === baselineCode) {
                const probeBodyStable = probe.response.getBody()?.toText() || '';
                const probeSig = KEY_WORDS_LOCAL.map(k => findMatches(probeBodyStable, k, true, sdk).length).join(',');
                if (probeSig === baselineSig) probeWasStable = true;
            }
            const probeBody = probe.response.getBody()?.toText() || '';
            const normalizedContentType = Array.isArray(ctHeader)
                ? ctHeader.find((value) => value && value.trim() !== "")
                : typeof ctHeader === "string" && ctHeader.trim() !== "" ? ctHeader : "";
            const contentType = normalizedContentType.toLowerCase();
            const isJsonResponse = contentType.startsWith("application/json");
            const detectPg = isJsonResponse
                ? new JsonResponseBodyPayloadGenerator(probeBody)
                : new ResponseBodyPayloadGenerator(probeBody);
            for (const m of markers) {
                sdk.console.log(`[Reflector++] Analysing probe results for marker "${m.ch}"`);
                const encodedNeedle = m.pre + encodeURIComponent(m.ch) + m.suf;
                const decodedNeedle = m.pre + m.ch + m.suf;
                sdk.console.log(`[Reflector++] Looking for needle: ${encodedNeedle} in probe body ${probeBody.substring(0, 100)}...`);
                const foundEncoded = findMatches(probeBody, encodedNeedle, true, sdk).length > 0;
                const foundDecoded = isJsonResponse && findMatches(probeBody, decodedNeedle, true, sdk).length > 0;
                if (!foundEncoded && !foundDecoded) continue;
                const detections = detectPg.detect({ console: (sdk as any).console }, { context: contextInfo.context }, m.pre, m.ch, m.suf);
                if (detections.length > 0) {
                    confirmed = true;
                    const acceptedCtx = allowedDetectionContextsFor(bestContext);
                    const literalInContext = detections.some((d: any) => isLiteralContext(d.context) && (acceptedCtx.size === 0 || acceptedCtx.has(d.context)));
                    if (literalInContext) successfulChars.add(m.ch);
                    if (/^html$/i.test(bestContext) || /^body$/i.test(bestContext)) {
                        const preferred = detections.find((d: any) => isLiteralContext(d.context));
                        if (preferred) bestContext = preferred.context;
                    }
                }
            }
        } catch (e) { (sdk as any).console.log(`[Reflector++] Probe error for ${param.key}: ${e}`); }
    }
    return { confirmed, successfulChars, bestContext, probeWasStable };
}
