// Avoid importing types from '@caido/sdk-workflow' directly (d.ts not a module under NodeNext)
type HttpInput = any; type SDK = any; type Data = any; type RequestSpec = any;
import { scoreFinding } from "./analysis/scoring.js";
import { checkBodyReflections } from "./analysis/bodyReflection/bodyReflection.js";
import { checkHeaderReflections } from "./analysis/headerReflection.js";
import { buildEndpoint, passesContentTypeGating } from "./utils/http.js";
import { AnalyzedReflectedParameter } from "./core/types.js";
import { generateReport } from "./analysis/reporting.js";
import { COMMON_ANALYTICS_HOSTS_SET, COMMON_ANALYTICS_ENDPOINTS_SET } from "./core/constants.js";
import { mergeEncodedSignals } from "./analysis/mergeEncodedSignals.js";
import { getEncodedSignals } from "./analysis/encodedSignalsStore.js";

// Use unified analyzed reflected parameter type
type ReflectedParameter = AnalyzedReflectedParameter;

// Pre-resolved host / endpoint sets (fixed spelling)
const analyticsHostsSet = COMMON_ANALYTICS_HOSTS_SET;
const analyticsEndpointsSet = COMMON_ANALYTICS_ENDPOINTS_SET;

/**
 * @param {HttpInput} input
 * @param {SDK} sdk
 * @returns {MaybePromise<Data | undefined>}
 */
export async function run(
    input: HttpInput,
    sdk: SDK
): Promise<Data | undefined> {
    const { request, response } = input;

    if (!request || !response) {
        sdk.console.log("[Reflector++] Skipping scan - request or response is missing");
        return;
    }

    // --- Mode toggle (configurable) ---
    // Modes:
    //   strict            -> only literal contexts become findings.
    //   strict+signals    -> literal findings + append informational encoded section.
    //   exploratory       -> promotes encoded signals to low-severity findings as well.
    // Order of resolution:
    //   1. Explicit override on input.config?.mode
    //   2. Environment variable REFLECTOR_MODE
    //   3. Default fallback "strict+signals"
    const rawMode = (input?.config?.mode || process?.env?.REFLECTOR_MODE || "strict+signals").toString().trim().toLowerCase();
    const VALID_MODES = new Set(["strict", "strict+signals", "exploratory"]);
    const MODE = VALID_MODES.has(rawMode) ? rawMode : "strict+signals";
    if (!VALID_MODES.has(rawMode)) {
        sdk.console.log(`[Reflector++] Unrecognized mode '${rawMode}', falling back to 'strict+signals'`);
    }

    sdk.console.log("=====================================");

    // 1. Always attempt header reflection detection regardless of content-type gating
    const headerReflections = await checkHeaderReflections(request, response, sdk);

    // 2. Apply body/content related gating only for body reflection scanning
    const rawContentType = response.getHeader("Content-Type");
    const rawNoSniff = response.getHeader("X-Content-Type-Options");
    let bodyReflections: ReflectedParameter[] = [];
    const proceedBody = (() => {
        if (!passesContentTypeGating(rawContentType, rawNoSniff)) return false;
        const reqMethod = request.getMethod();
        if (reqMethod !== "GET" && reqMethod !== "POST") return false;
        if (analyticsHostsSet.has(request.getHost())) return false;
        if (analyticsEndpointsSet.has(request.getPath())) return false;
        if (response.getBody()?.toText() === "") return false;
        return true;
    })();

    if (!proceedBody) {
        sdk.console.log("[Reflector++] Body reflection scan skipped due to gating checks; header results retained.");
    } else {
    bodyReflections = await checkBodyReflections(input, sdk);
    }

    const reflectedParameters = [...headerReflections, ...bodyReflections];

    const encodedSignals = getEncodedSignals(input);

    if (MODE === "exploratory" && encodedSignals?.length) {
        const merged = mergeEncodedSignals(encodedSignals);
        for (const [name, m] of merged.entries()) {
            // Pick a representative escaped context to score
            let ctx: string;
            if (m.contexts.has("attributeEscaped")) {
                ctx = "attributeEscaped";
            } else if (m.contexts.has("eventHandlerEscaped")) {
                ctx = "eventHandlerEscaped";
            } else if (m.contexts.has("jsonEscaped")) {
                ctx = "jsonEscaped";
            } else {
                ctx = "html";
            }

            // Low severity, unconfirmed (encoded) finding
            const { confidence, severity, total } = scoreFinding({
                confirmed: false,
                allowedChars: [],
                context: ctx,
                header: false,
                matchCount: m.count,
                bodyLength: response.getBody()?.toText()?.length ?? 0,
                stableProbe: false
            });

            reflectedParameters.push({ name, matches: new Array(m.count).fill([0, 0]) as any, context: ctx, aggressive: undefined, source: m.source as any, certainty: total, confidence, severity, score: total });
        }
    }

    const hasLiteral = reflectedParameters.length > 0;
    let details = "";

    if (hasLiteral) {
        sdk.console.log(`[Reflector++] Found ${reflectedParameters.length} reflected parameter(s)`);
        details += "The following parameters were reflected in the response:\n";
        details += "--------\n";
        for (const p of reflectedParameters) details += generateReport(p) + "\n";
    } else {
        sdk.console.log("[Reflector++] No reflected parameters found");
        details += "No confirmed literal reflections detected.\n";
    }

    // Append encoded signal section if enabled
    if ((MODE === "strict+signals" || MODE === "exploratory") && encodedSignals?.length) {
        const { buildEncodedSignalsSection } = await import("./analysis/reporting.js");
        details += buildEncodedSignalsSection(encodedSignals);
    }

    // Unified finding creation (avoid duplicates)
    if (hasLiteral || (MODE !== "strict" && encodedSignals?.length)) {
        const endpoint = buildEndpoint(request);
        const keyParts = reflectedParameters
            .map(r => `${r.name}@${(r.context || "").toLowerCase()}`)
            .sort();
        const dedupeKey = `${endpoint}|${keyParts.join(",")}`;
        await sdk.findings.create({
            title: hasLiteral ? "Reflected parameters" : "Encoded reflections (informational)",
            reporter: "Reflector++",
            request,
            description: details,
            dedupeKey
        });
    }

}

