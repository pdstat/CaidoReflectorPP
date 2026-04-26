// Avoid importing types from '@caido/sdk-workflow' directly (d.ts not a module under NodeNext)
type HttpInput = any; type SDK = any; type Data = any;
import { checkBodyReflections } from "./analysis/bodyReflection/bodyReflection.js";
import { checkHeaderReflections } from "./analysis/headerReflection.js";
import { buildEndpoint, passesContentTypeGating } from "./utils/http.js";
import { AnalyzedReflectedParameter, SEVERITY_ORDER } from "./core/types.js";
import {
  generateReport,
  buildEncodedSignalsSection,
  buildRequestContextLine,
  buildStructuredDataBlock,
  buildFindingTitle
} from "./analysis/reporting.js";
import { COMMON_ANALYTICS_HOSTS_SET, COMMON_ANALYTICS_ENDPOINTS_SET } from "./core/constants.js";
import { mergeEncodedSignals } from "./analysis/mergeEncodedSignals.js";
import { CONTEXT } from "./analysis/contextMap.js";
import { getEncodedSignals } from "./analysis/encodedSignalsStore.js";
import { ConfigStore } from "./stores/configStore.js";

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

    const pathBlocklist = ConfigStore.getPathBlocklist();
    if (pathBlocklist.length > 0) {
        const reqPath = request.getPath();
        for (const pattern of pathBlocklist) {
            try {
                if (new RegExp(pattern).test(reqPath)) {
                    sdk.console.log(`[Reflector++] Skipping scan - path "${reqPath}" matches blocklist pattern: ${pattern}`);
                    return;
                }
            } catch {
                // skip invalid regex patterns
            }
        }
    }

    const LOG_UNCONFIRMED_FINDINGS = ConfigStore.getLogUnconfirmedFindings();
    const noSniffContentTypes = ConfigStore.getNoSniffContentTypes();
    sdk.console.log(`[Reflector++] Starting scan (Log unconfirmed findings: ${LOG_UNCONFIRMED_FINDINGS ? "enabled" : "disabled"})`);
    sdk.console.log(`[Reflector++] Starting scan (No-Sniff Content Types: ${Array.from(noSniffContentTypes).join(", ")})`);
    sdk.console.log("=====================================");

    // 1. Always attempt header reflection detection regardless of content-type gating unless disabled
    const checkResponseHeaderReflections = ConfigStore.getCheckResponseHeaderReflections();
    const headerReflections = checkResponseHeaderReflections ? await checkHeaderReflections(request, response, sdk) : [];

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
    bodyReflections = await checkBodyReflections(input, sdk, LOG_UNCONFIRMED_FINDINGS);
    }

    const reflectedParameters = [...headerReflections, ...bodyReflections];

    const encodedSignals = getEncodedSignals(input);

    if (LOG_UNCONFIRMED_FINDINGS && encodedSignals?.length) {
        const merged = mergeEncodedSignals(encodedSignals);
        for (const [name, m] of merged.entries()) {
            let ctx: string;
            if (m.contexts.has(CONTEXT.ATTRIBUTE_ESCAPED)) {
                ctx = CONTEXT.ATTRIBUTE_ESCAPED;
            } else if (m.contexts.has(CONTEXT.EVENT_HANDLER_ESCAPED)) {
                ctx = CONTEXT.EVENT_HANDLER_ESCAPED;
            } else if (m.contexts.has(CONTEXT.JSON_ESCAPED)) {
                ctx = CONTEXT.JSON_ESCAPED;
            } else {
                ctx = CONTEXT.HTML;
            }
            reflectedParameters.push({
                name,
                matches: new Array(m.count).fill([0, 0]) as Array<[number, number]>,
                context: ctx,
                source: m.source as ReflectedParameter["source"],
                confirmed: false,
                severity: 'info'
            });
        }
    }

    const hasLiteral = reflectedParameters.length > 0;
    const hasEncoded = LOG_UNCONFIRMED_FINDINGS && !!encodedSignals?.length;

    if (hasLiteral || hasEncoded) {
        sdk.console.log(`[Reflector++] Found ${reflectedParameters.length} reflected parameter(s)`);

        const endpoint = buildEndpoint(request);
        const method = request.getMethod?.() || "GET";
        const statusCode = response.getCode?.() ?? 0;
        const bodyText = response.getBody()?.toText() || "";
        const ctHeader = rawContentType;
        const cspHeader = response.getHeader("Content-Security-Policy");
        const xctoHeader = rawNoSniff;
        const contentType = Array.isArray(ctHeader)
            ? ctHeader[0] : (typeof ctHeader === "string" ? ctHeader : undefined);
        const csp = Array.isArray(cspHeader)
            ? cspHeader[0] : (typeof cspHeader === "string" ? cspHeader : undefined);
        const xcto = Array.isArray(xctoHeader)
            ? xctoHeader[0] : (typeof xctoHeader === "string" ? xctoHeader : undefined);

        let description = buildRequestContextLine({
            method, url: endpoint, statusCode, contentType, csp, xcto
        });
        description += '\n\n---\n\n';

        reflectedParameters.sort(
            (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
        );

        for (const p of reflectedParameters) {
            description += generateReport(p, bodyText) + '\n\n---\n\n';
        }

        if (hasEncoded) {
            description += buildEncodedSignalsSection(encodedSignals);
            description += '\n\n---\n\n';
        }

        description += buildStructuredDataBlock(reflectedParameters);

        const title = buildFindingTitle(reflectedParameters, hasLiteral);

        const keyParts = reflectedParameters
            .map(r => `${r.name}@${(r.context || "").toLowerCase()}`)
            .sort();
        const dedupeKey = `${method}:${endpoint}|${keyParts.join(",")}`;

        await sdk.findings.create({
            title,
            reporter: "Reflector++",
            request,
            description,
            dedupeKey
        });
    } else {
        sdk.console.log("[Reflector++] No reflected parameters found");
    }

}

